from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import auth, crud, models
from app.auth import get_current_superuser
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, client_rate_key, limiter
from app.middleware import get_logger
from app.webpush import (
    MAX_PUSH_SUBSCRIPTIONS_PER_SOURCE,
    _b64url_decode,
    _endpoint_host_is_internal_literal,
    dispatch_to_subscriptions,
    vapid_configured,
    vapid_public_key,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/push", tags=["push"])


class SubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    # Endpoints are vendor push-service URLs (up to a few hundred chars);
    # match the PushSubscription.endpoint VARCHAR(500) column so over-length
    # input is rejected with 422 instead of an uncaught DataError -> 500.
    endpoint: str = Field(max_length=500)
    keys: SubscriptionKeys
    # New-post notification opt-in (DEC-076, TASK-147): want_new_posts enables
    # new-post pushes for this browser; new_post_category_id narrows them to a
    # single followed category (None = all new posts).
    want_new_posts: bool = False
    new_post_category_id: int | None = None

    @field_validator("endpoint")
    @classmethod
    def check_endpoint_scheme(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("endpoint must be an absolute http(s) URL")
        # SSRF guard, DNS-free layer (security review): reject hosts that are
        # inherently internal literals — localhost, mDNS (.local), private
        # suffixes, and bare private/loopback/link-local IPs. A bespoke push
        # endpoint pointing at cloud metadata (http://169.254.169.254/) or an
        # internal service must never be stored, or the server would later be
        # made to dial it. (Hostnames resolving internally are blocked at
        # dispatch in webpush._endpoint_targets_internal where DNS is real.)
        if _endpoint_host_is_internal_literal(value):
            raise ValueError("endpoint must be a public push-service URL")
        return value


class PushSubscriptionResponse(BaseModel):
    id: int
    endpoint: str


class NotifyRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=2000)
    # Notification click targets a site page; restricted to same-site relative
    # paths so a compromised/inexperienced admin cannot push a link that
    # redirects every subscriber off-site (each reader sees a clickable link
    # served by them).
    url: str = Field(default="/", max_length=500)

    @field_validator("url")
    @classmethod
    def check_same_site_url(cls, value: str) -> str:
        if not value.startswith("/") or value.startswith("//") or ":" in value.split("/")[0]:
            raise ValueError("url must be a same-site relative path, e.g. /posts/my-post")
        return value


# ---------------------------------------------------------------------------
# Public key — the browser's pushManager.subscribe applicationServerKey.
# ---------------------------------------------------------------------------


@router.get("/vapid-public-key")
def get_vapid_public_key():
    """Return the VAPID public key browsers need to subscribe, or 503 unconfigured."""
    if not vapid_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web Push is not configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset)",
        )
    return {"public_key": vapid_public_key()}


# ---------------------------------------------------------------------------
# Reader subscription (public, unauthenticated) — the endpoint+keys the
# browser generated; we store them to deliver notifications later.
# ---------------------------------------------------------------------------


@router.post("/subscribe", response_model=PushSubscriptionResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def subscribe(
    request: Request,  # noqa: ARG001
    data: PushSubscriptionCreate,
    db: Session = Depends(get_db),
    reader: auth.ReaderAccount | None = Depends(auth.get_optional_reader),
):
    if not vapid_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web Push is not configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset)",
        )
    # p256dh must be the 65-byte uncompressed EC point the browser generated;
    # auth must be the 16-byte encryption salt. Anything else cannot be
    # encrypted for (http-ece) and would fail every dispatch.
    p256dh_bytes = _b64url_decode(data.keys.p256dh)
    if p256dh_bytes is None or len(p256dh_bytes) != 65:
        raise HTTPException(status_code=422, detail="keys.p256dh must be a 65-byte base64url EC point")
    auth_bytes = _b64url_decode(data.keys.auth)
    if auth_bytes is None or len(auth_bytes) != 16:
        raise HTTPException(status_code=422, detail="keys.auth must be a 16-byte base64url value")

    # A category-scoped new-post follow must reference an existing category:
    # the fan-out matches on the category id, so an unknown id would silently
    # never notify (DEC-076, TASK-147).
    if data.new_post_category_id is not None and crud.get_category(db, data.new_post_category_id) is None:
        raise HTTPException(status_code=422, detail="Unknown new_post_category_id")

    # Bind the subscription to the reader account when the subscribe request
    # carries a reader JWT (targeted notifications, DEC-064/TASK-137).
    reader_id = reader.id if reader else None
    existing = db.query(models.PushSubscription).filter(models.PushSubscription.endpoint == data.endpoint).first()
    if existing:
        # Ownership guard (security review): re-subscribing must not let one
        # reader silently repoint another reader's subscription to themselves —
        # the row is that reader's device binding, and the attacker needs only
        # the (logged) endpoint + keys to steal and revoke it. Only bind when
        # the row is unclaimed (anonymous) or already belongs to this reader.
        if reader_id is not None and existing.reader_id is not None and existing.reader_id != reader_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This push endpoint is already bound to another account",
            )
        sub = existing
        sub.p256dh = data.keys.p256dh
        sub.auth = data.keys.auth
        sub.reader_id = reader_id or existing.reader_id
        sub.want_new_posts = data.want_new_posts
        sub.new_post_category_id = data.new_post_category_id
        db.commit()
        db.refresh(sub)
        return sub
    # Unbounded rows driven by anonymous input grew the table without limit and
    # amplified the (serial) dispatch loop; cap per source. One browser = one
    # endpoint, so a handful of subscriptions per source is generous: bound by
    # the subscribing reader when signed in, else by the client IP (stamped on
    # the row via ip_key, DEC-009 additive) since anonymous subs have no reader
    # identity.
    cap = MAX_PUSH_SUBSCRIPTIONS_PER_SOURCE
    ip_key = client_rate_key(request)
    if reader_id is not None:
        existing_count = (
            db.query(models.PushSubscription).filter(models.PushSubscription.reader_id == reader_id).count()
        )
        note = f"reader {reader_id}"
    else:
        existing_count = (
            db.query(models.PushSubscription)
            .filter(
                models.PushSubscription.reader_id.is_(None),
                models.PushSubscription.ip_key == ip_key,
            )
            .count()
        )
        note = f"IP {ip_key}"
    if existing_count >= cap:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many push subscriptions ({note})",
        )
    sub = models.PushSubscription(
        endpoint=data.endpoint,
        p256dh=data.keys.p256dh,
        auth=data.keys.auth,
        reader_id=reader_id,
        ip_key=ip_key if reader_id is None else None,
        want_new_posts=data.want_new_posts,
        new_post_category_id=data.new_post_category_id,
    )
    db.add(sub)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent subscribe for the same endpoint won the unique-key race:
        # roll back and treat this as the idempotent re-subscribe path (ISS-143).
        db.rollback()
        existing = db.query(models.PushSubscription).filter(models.PushSubscription.endpoint == data.endpoint).first()
        if existing:
            db.refresh(existing)
            return existing
        raise
    db.refresh(sub)
    return sub


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    request: Request,  # noqa: ARG001
    data: PushSubscriptionCreate,
    db: Session = Depends(get_db),
):
    """Remove a subscription (idempotent: already-absent endpoints are a no-op).

    Deliberately POST, not DELETE: the (httpx2) backend client and several
    browser fetch stacks do not serialize bodies on DELETE, and the request
    carries the endpoint the way subscribe does. (DEC-055, TASK-117)

    Proof-of-possession guard (security review): only the browser that holds
    the subscription's encryption keys may revoke it. Endpoints circulate
    (dispatch-failure logs, the reader's own list endpoint), so deleting by
    endpoint ALONE let anyone who captured one silently kill a target's
    subscriptions. The keys the browser sends back are high-entropy and known
    only to it — match on both.
    """
    db.query(models.PushSubscription).filter(
        models.PushSubscription.endpoint == data.endpoint,
        models.PushSubscription.p256dh == data.keys.p256dh,
        models.PushSubscription.auth == data.keys.auth,
    ).delete()
    db.commit()


# ---------------------------------------------------------------------------
# Dispatch (superuser-only broadcast to all subscribers).
# ---------------------------------------------------------------------------


@router.post("/notify")
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def notify_subscribers(
    request: Request,  # noqa: ARG001
    data: NotifyRequest,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    """Broadcast a notification to every stored subscription.

    Retires subscriptions the push service reports as gone (410/404) so the
    table does not accumulate dead endpoints, and never fails the request
    because one subscriber's endpoint is down. Uses the shared dispatch helper
    (same as targeted reader notifications, DEC-064/TASK-137).
    """
    if not vapid_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web Push is not configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset)",
        )
    payload = {"title": data.title, "body": data.body, "url": data.url}
    subscriptions = db.query(models.PushSubscription).all()
    result = dispatch_to_subscriptions(subscriptions, payload, db, logger)
    return {"total": len(subscriptions), **result}
