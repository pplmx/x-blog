"""Public guest-newsletter endpoints (DEC-351, TASK-401).

An anonymous visitor who just wants "email me new posts" (no account, no
comment) subscribes with an email address. Double opt-in: ``/subscribe``
records the address and emails a confirmation link carrying a per-subscriber
token; the address receives NO new-post email until ``/confirm`` is posted with
that token. ``/unsubscribe`` flips the consent off via the same token, so a
per-address revoked consent stays permanent without an account.

Security posture (mirroring existing no-oracle patterns):

- ``subscribe`` always returns the SAME body whether the address is new, was
  already subscribed, or was unsubscribed before — it is not an email-existence
  oracle (same non-oracle stance as reader register / password-reset request).
  It deliberately never reveals whether a second confirmation email was sent.
- ``token`` is a random opaque secret only the emailed link carries (stored,
  not derivable; mirror of Comment.reply_notify_token, DEC-332). ``confirm`` /
  ``unsubscribe`` with an unknown token are 404 — indistinguishable from
  "nothing was ever subscribed at this address" for a random guess.
- ``confirm``/``unsubscribe`` are idempotent (a twice-clicked link is a 200),
  so a mail client that re-opens the link can never error.
"""

from datetime import datetime
from secrets import token_urlsafe
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import auth, models, schemas
from app.crud import escape_like_pattern, utc_now_naive
from app.database import get_db
from app.emailer import send_newsletter_confirm_email
from app.limiter import RATE_LIMIT_NEWSLETTER, RATE_LIMIT_READ, RATE_LIMIT_WRITE, limiter
from app.middleware import get_logger
from app.schemas import NonNulStr

logger = get_logger(__name__)

router = APIRouter(prefix="/api/newsletter", tags=["newsletter"])

# Bounded like the shared email writers (max_length 254 matches the model
# column and EMAIL_PATTERN keeps garbage out of the subscriber table).
EMAIL_PATTERN = schemas.EMAIL_PATTERN


class NewsletterSubscribeBody(BaseModel):
    email: Annotated[NonNulStr, Field(min_length=3, max_length=254, pattern=EMAIL_PATTERN)]
    # Optional cadence (DEC-355, TASK-403): True chooses the weekly digest over
    # per-post mail, stored on the new row. Default stays per-post; a resubscribed
    # existing address keeps whatever cadence it already had (never re-flipped).
    digest_weekly: bool = False

    @field_validator("email", mode="before")
    @classmethod
    def strip_email(cls, value: object) -> object:
        # Whitespace-only / padded input is normalized before pattern+length
        # validation (schemas._strip_blank runs for the shared comment/reader
        # writers; the newsletter must agree so "  a@b.co  " is not persisted).
        return schemas._strip_blank(value) if isinstance(value, str) else value


class NewsletterTokenBody(BaseModel):
    token: Annotated[NonNulStr, Field(max_length=64)]


class NewsletterDigestBody(BaseModel):
    token: Annotated[NonNulStr, Field(max_length=64)]
    enabled: bool


@router.post("/subscribe", status_code=202)
@limiter.limit(f"{RATE_LIMIT_NEWSLETTER}/minute")
def newsletter_subscribe(
    request: Request,  # noqa: ARG001 — slowapi injects for the rate-limit key
    body: NewsletterSubscribeBody,
    db: Session = Depends(get_db),
):
    """Record the email and send a double opt-in confirmation link.

    One generic message regardless of outcome (no existence oracle). The
    confirmation email carries a fresh per-subscriber token; a resubscribed or
    already-existing address keeps its row (unique constraint) — no duplicate
    rows can ever be created.

    Anti-abuse (security review): the confirmation email fires ONLY when a NEW
    row is created or an explicitly UNSUBSCRIBED one re-subscribes. A pending or
    confirmed address is never re-emailed, so a single attacker cannot turn
    each of N subscribe calls into N outbound mails to a victim address — the
    unauthenticated entry is also on a dedicated tight per-IP bucket
    (``RATE_LIMIT_NEWSLETTER``), not the looser write bucket. The unsubscribed
    re-subscribe branch is required consent semantics (round 393): reactivation
    needs a FRESH double-opt-in, never a replay of the cancelled address's old
    confirmation link.
    """
    email = body.email.strip().lower()

    row = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.email == email).first()
    if row is None:
        row = models.NewsletterSubscriber(
            email=email,
            token=token_urlsafe(32),
            is_confirmed=False,
            digest_weekly=body.digest_weekly,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            # A concurrent subscribe won the unique-email race; reuse the row
            # that other request created (it is pending, and it is the one to
            # send its own confirmation — so this request must NOT also mail,
            # or the address gets two confirmation links).
            db.rollback()
            row = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.email == email).first()
            if row is None:  # shared-unique race with no winner observable here — treat as transient failure
                raise
        else:
            # Our insert won the race — this is the ONE confirmation email to
            # send. Firing only here keeps the anti-abuse guarantee (a newly
            # created row is mailed once; a resubscribed address never is).
            # Best-effort: a failure is swallowed (never an error to the
            # subscriber); SMTP unconfigured -> the address just stays pending.
            db.refresh(row)
            try:
                send_newsletter_confirm_email(email, row.token)
            except Exception:  # noqa: BLE001
                logger.exception("newsletter confirmation email failed for %s", email)
    elif row.unsubscribed_at is not None:
        # A deliberately cancelled address re-subscribes the RIGHT way: a fresh
        # token + a fresh double-opt-in email, so replaying the old confirmation
        # link can never silently flip it back to subscribed (round 393). The
        # anti-abuse guarantee is unchanged for pending/confirmed rows (which
        # still take the no-op path) and the tight per-IP bucket still applies.
        row.is_confirmed = False
        row.confirmed_at = None
        row.unsubscribed_at = None
        row.digest_weekly = body.digest_weekly
        row.token = token_urlsafe(32)
        db.commit()
        db.refresh(row)
        try:
            send_newsletter_confirm_email(email, row.token)
        except Exception:  # noqa: BLE001
            logger.exception("newsletter confirmation email failed for %s", email)
    return {"subscribed": True, "message": "If this email is new, a confirmation link is on its way"}


@router.post("/confirm", status_code=200)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def newsletter_confirm(
    request: Request,  # noqa: ARG001
    body: NewsletterTokenBody,
    db: Session = Depends(get_db),
):
    """Activate an address after its confirmation link is clicked.

    Idempotent (a second click with the same token is a 200); an unknown token
    is 404 so comment-id-style enumeration is impossible.
    """
    row = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.token == body.token).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Invalid token")
    if not row.is_confirmed:
        # Consent restart gate (round 393): an address that was explicitly
        # unsubscribed must NOT be re-activated by replaying its OLD
        # confirmation link with no fresh opt-in email — the holder cancelled
        # it, and re-activation starts over via subscribe (fresh token + fresh
        # confirmation mail). Only a pending (never-confirmed) address confirms
        # straight out of its original email.
        if row.unsubscribed_at is not None:
            raise HTTPException(
                status_code=400,
                detail="This address was unsubscribed. Please subscribe again to reactivate",
            )
        row.is_confirmed = True
        row.confirmed_at = utc_now_naive()
        db.commit()
    # The cadence is returned so the confirm page can show the address's real
    # state (a digest_weekly opt-in at subscribe time shows as such, not as an
    # unchecked per-post default) — not an oracle: only the token holder sees
    # it (DEC-355, TASK-403).
    return {"confirmed": True, "digest_weekly": row.digest_weekly}


@router.post("/unsubscribe", status_code=200)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def newsletter_unsubscribe(
    request: Request,  # noqa: ARG001
    body: NewsletterTokenBody,
    db: Session = Depends(get_db),
):
    """Flip an address's newsletter consent off via its emailed token.

    Idempotent (a second click with the same token is a 200); an unknown token
    is 404. The row + token stay so a stale link keeps working and the address
    is not re-emailed new posts.
    """
    row = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.token == body.token).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Invalid token")
    if row.is_confirmed:
        row.is_confirmed = False
        row.confirmed_at = None
        # Round 393: record the cancellation so replaying the OLD confirmation
        # link cannot silently re-activate the address (re-activation requires a
        # fresh subscribe + fresh double-opt-in email).
        row.unsubscribed_at = utc_now_naive()
        db.commit()
    return {"unsubscribed": True}


@router.post("/digest", status_code=200)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def newsletter_digest(
    request: Request,  # noqa: ARG001
    body: NewsletterDigestBody,
    db: Session = Depends(get_db),
):
    """Flip one address's cadence between per-post mail and the weekly digest.

    Token-gated exactly like confirm/unsubscribe — an unknown token is 404
    (indistinguishable from never-subscribed, no oracle) and the toggle is
    idempotent (a twice-clicked link is a 200). ``enabled=False`` returns the
    address to the per-post channel; ``digest_weekly`` subscribers are served
    by the weekly digest job instead of the per-post fan-out (DEC-355).
    """
    row = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.token == body.token).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Invalid token")
    if row.digest_weekly != body.enabled:
        row.digest_weekly = body.enabled
        db.commit()
    return {"digest_weekly": body.enabled}


# Admin subscriber management (DEC-354, TASK-402)
# ---------------------------------------------------------------------------
# The public surface (subscribe/confirm/unsubscribe) has no operator view: an
# admin cannot see who is on the list, how many are confirmed vs pending, or
# remove an address. These admin-scoped endpoints fill that gap. Additive and
# separate from the public token flow — DELETE removes the row AND its token,
# so a subsequently posted token is a 404 (indistinguishable from
# never-subscribed, no oracle).

admin_router = APIRouter(prefix="/api/admin/newsletter", tags=["newsletter"])


class AdminSubscriberItem(BaseModel):
    """One newsletter subscriber as the admin list serializes it."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    is_confirmed: bool
    # Exposed so an operator can see why a confirmed address is NOT in the
    # per-post fan-out (it chose the weekly digest) — DEC-355.
    digest_weekly: bool = False
    created_at: datetime | None = None
    confirmed_at: datetime | None = None


class AdminSubscriberListResponse(BaseModel):
    items: list[AdminSubscriberItem]
    pagination: dict[str, int]


@admin_router.get("/subscribers", response_model=AdminSubscriberListResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def admin_list_subscribers(
    request: Request,  # noqa: ARG001
    status: str | None = Query(None, pattern="^(confirmed|pending)$", description="filter by confirmation state"),
    q: Annotated[NonNulStr | None, Query(max_length=254, description="case-insensitive email substring")] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _current_user: auth.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    """List newsletter subscribers, newest first, with status/search filters."""
    query = db.query(models.NewsletterSubscriber)
    if status == "confirmed":
        query = query.filter(models.NewsletterSubscriber.is_confirmed.is_(True))
    elif status == "pending":
        query = query.filter(models.NewsletterSubscriber.is_confirmed.is_(False))
    if q:
        # Literal substring match: % and _ in the term must not act as
        # wildcards (readers-list convention, crud.escape_like_pattern) —
        # unescaped they would degenerate into full-table matches.
        query = query.filter(models.NewsletterSubscriber.email.ilike(f"%{escape_like_pattern(q)}%", escape="\\"))
    total = query.count()
    rows = (
        query.order_by(
            models.NewsletterSubscriber.created_at.desc(),
            models.NewsletterSubscriber.id.desc(),
        )
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    return {
        "items": [AdminSubscriberItem.model_validate(r) for r in rows],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if total else 0,
        },
    }


class AdminDigestOverviewResponse(BaseModel):
    """The operator-facing reading surface for the weekly digest (DEC-423).

    Complements the ``send-weekly`` trigger with the numbers that say whether
    the digest is alive: how many readers and guests opted into the weekly
    cadence, when a digest last actually went out, and how many posts the
    rolling window would contain right now.
    """

    reader_digest_subscribers: int
    guest_digest_subscribers: int
    #: Max digest_sent_at across reader prefs and newsletter rows (naive UTC —
    #: reads with the same zone-less convention as the digest stamps); null
    #: when nothing has ever been delivered.
    last_sent_at: datetime | None
    #: Public posts whose effective publish time falls in the digest window
    #: (``collect_digest_posts`` length) — the superset a send is capped by
    #: (per-recipient windows can shrink to their own ``digest_sent_at``).
    window_posts: int


@admin_router.get("/digest/overview", response_model=AdminDigestOverviewResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def admin_digest_overview(
    request: Request,  # noqa: ARG001
    _current_user: auth.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    """Report the weekly digest's current state (DEC-423, TASK-436).

    Read-only monitoring surface next to ``POST /api/admin/digests/send-weekly``:
    reader + guest subscriber counts on the weekly cadence, the last delivery
    timestamp, and the number of posts the rolling window would carry. No mail
    is sent, no locks taken, nothing stamped — pure aggregation, safe to poll.
    """
    from app.digest import collect_digest_posts

    now_naive = utc_now_naive()

    reader_count = (
        db.query(auth.ReaderAccount)
        .join(models.ReaderNotificationPref, models.ReaderNotificationPref.reader_id == auth.ReaderAccount.id)
        .filter(
            auth.ReaderAccount.is_active.is_(True),
            models.ReaderNotificationPref.email_weekly_digest.is_(True),
        )
        .count()
    )
    guest_count = (
        db.query(models.NewsletterSubscriber)
        .filter(
            models.NewsletterSubscriber.is_confirmed.is_(True),
            models.NewsletterSubscriber.digest_weekly.is_(True),
        )
        .count()
    )

    # Latest non-null digest_sent_at across both recipient kinds (a reader pref
    # or a guest row). MAX() skips NULLs and returns NULL on an all-NULL set,
    # so this is exactly "the most recent stamp, or None if nothing went out".
    sent_ts = db.query(func.max(models.ReaderNotificationPref.digest_sent_at)).scalar()
    guest_ts = db.query(func.max(models.NewsletterSubscriber.digest_sent_at)).scalar()
    last_sent: datetime | None = max(
        (t for t in (sent_ts, guest_ts) if t is not None),
        default=None,
    )

    # The same rolling-window superset the job itself uses — the number of
    # posts a send would (at most) carry. Reuses the digest module's query so
    # the preview and the job can never drift apart.
    window_posts = len(collect_digest_posts(db, now_naive))

    return AdminDigestOverviewResponse(
        reader_digest_subscribers=reader_count,
        guest_digest_subscribers=guest_count,
        last_sent_at=last_sent,
        window_posts=window_posts,
    )


@admin_router.delete("/subscribers/{subscriber_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def admin_delete_subscriber(
    request: Request,  # noqa: ARG001
    subscriber_id: int,
    _current_user: auth.User = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    """Remove a newsletter subscriber (row + token) entirely.

    For a subscriber who asked to be removed (and lost their token) or an
    address someone else subscribed. The row is gone, so that address is never
    re-emailed new posts and a subsequently posted token is a 404.
    """
    row = db.get(models.NewsletterSubscriber, subscriber_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    db.delete(row)
    db.commit()
    return None
