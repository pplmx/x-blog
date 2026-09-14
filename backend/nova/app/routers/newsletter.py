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

from secrets import token_urlsafe
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app import models, schemas
from app.crud import utc_now_naive
from app.database import get_db
from app.emailer import send_newsletter_confirm_email
from app.limiter import RATE_LIMIT_WRITE, limiter
from app.middleware import get_logger
from app.schemas import NonNulStr

logger = get_logger(__name__)

router = APIRouter(prefix="/api/newsletter", tags=["newsletter"])

# Bounded like the shared email writers (max_length 254 matches the model
# column and EMAIL_PATTERN keeps garbage out of the subscriber table).
EMAIL_PATTERN = schemas.EMAIL_PATTERN


class NewsletterSubscribeBody(BaseModel):
    email: Annotated[NonNulStr, Field(min_length=3, max_length=254, pattern=EMAIL_PATTERN)]

    @field_validator("email", mode="before")
    @classmethod
    def strip_email(cls, value: object) -> object:
        # Whitespace-only / padded input is normalized before pattern+length
        # validation (schemas._strip_blank runs for the shared comment/reader
        # writers; the newsletter must agree so "  a@b.co  " is not persisted).
        return schemas._strip_blank(value) if isinstance(value, str) else value


class NewsletterTokenBody(BaseModel):
    token: Annotated[NonNulStr, Field(max_length=64)]


@router.post("/subscribe", status_code=202)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
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
    """
    email = body.email.strip().lower()

    row = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.email == email).first()
    if row is None:
        row = models.NewsletterSubscriber(
            email=email,
            token=token_urlsafe(32),
            is_confirmed=False,
        )
        db.add(row)
        try:
            db.commit()
        except Exception:  # noqa: BLE001 — concurrent insert lost the unique race
            db.rollback()
            row = db.query(models.NewsletterSubscriber).filter(models.NewsletterSubscriber.email == email).first()
            if row is None:  # shared-unique race with no winner observable here — treat as transient failure
                raise
        db.refresh(row)
    # Best-effort confirmation email. A failure is swallowed (never an error
    # to the subscriber); SMTP unconfigured -> the address just stays pending.
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
        row.is_confirmed = True
        row.confirmed_at = utc_now_naive()
        db.commit()
    return {"confirmed": True}


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
        db.commit()
    return {"unsubscribed": True}
