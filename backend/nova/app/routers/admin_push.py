"""Admin Web Push subscriptions for moderation alerts (DEC-080).

The blog moderates every comment (no auto-approve), so an admin — superuser or
editor, DEC-054 role tiers — only learns a comment is waiting by re-opening the
moderation queue. These endpoints let an admin opt this browser into a push
when a new comment is created (pending), deep-linking to /admin/comments.

Deliberately admin-scoped: guarded by ``get_current_admin`` and stored in
``AdminPushSubscription`` — a table separate from the reader
``PushSubscription`` so a moderation push can never leak into the reader
fan-outs, mirroring the User/ReaderAccount audience separation (DEC-059).
"""

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app import models
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter
from app.middleware import get_logger
from app.webpush import _b64url_decode, vapid_configured

logger = get_logger(__name__)

router = APIRouter(prefix="/api/admin/push", tags=["push"])


class AdminSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class AdminPushSubscriptionCreate(BaseModel):
    # Endpoints are vendor push-service URLs (up to a few hundred chars);
    # match the AdminPushSubscription.endpoint VARCHAR(500) column so over-length
    # input is rejected with 422 instead of an uncaught DataError -> 500.
    endpoint: str = Field(max_length=500)
    keys: AdminSubscriptionKeys

    @field_validator("endpoint")
    @classmethod
    def check_endpoint_scheme(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("endpoint must be an absolute http(s) URL")
        return value


class AdminPushSubscriptionResponse(BaseModel):
    id: int
    endpoint: str
    user_id: int


class AdminPushSubscriptionsList(BaseModel):
    """The current admin's registered moderation-push endpoints."""

    items: list[AdminPushSubscriptionResponse]


def _validate_keys(keys: AdminSubscriptionKeys) -> None:
    """Reject anything http-ece cannot encrypt for (mirrors /api/push/subscribe)."""
    p256dh_bytes = _b64url_decode(keys.p256dh)
    if p256dh_bytes is None or len(p256dh_bytes) != 65:
        raise HTTPException(status_code=422, detail="keys.p256dh must be a 65-byte base64url EC point")
    auth_bytes = _b64url_decode(keys.auth)
    if auth_bytes is None or len(auth_bytes) != 16:
        raise HTTPException(status_code=422, detail="keys.auth must be a 16-byte base64url value")


@router.get("/subscriptions", response_model=AdminPushSubscriptionsList)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def admin_list_subscriptions(
    request: Request,  # noqa: ARG001
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """This admin's moderation-push endpoints.

    The admin UI calls this on mount to decide whether the ACTIVE browser
    subscription's endpoint is already registered, instead of inferring
    "subscribed" from the browser's push subscription alone — a browser can
    hold one push subscription (shared with the reader opt-in, same /sw.js
    registration), so the moderation opt-in lives in its own table and its
    state is queried here (DEC-080).
    """
    rows = (
        db.query(models.AdminPushSubscription)
        .filter(models.AdminPushSubscription.user_id == current_user.id)
        .order_by(models.AdminPushSubscription.id.desc())
        .all()
    )
    return AdminPushSubscriptionsList(
        items=[
            AdminPushSubscriptionResponse(
                id=row.id,
                endpoint=row.endpoint,
                user_id=row.user_id,
            )
            for row in rows
        ]
    )


@router.post("/subscribe", response_model=AdminPushSubscriptionResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def admin_subscribe(
    request: Request,  # noqa: ARG001
    data: AdminPushSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Register (or update) this admin's browser for moderation pushes."""
    if not vapid_configured():
        raise HTTPException(
            status_code=503,
            detail="Web Push is not configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset)",
        )
    _validate_keys(data.keys)

    # Upsert by endpoint (a browser+origin yields one endpoint). Rebinding an
    # existing endpoint to the current admin mirrors how the reader subscribe
    # re-stamps reader_id — the same physical browser belongs to one person,
    # so the newest admin claiming it wins.
    existing = (
        db.query(models.AdminPushSubscription).filter(models.AdminPushSubscription.endpoint == data.endpoint).first()
    )
    if existing:
        existing.p256dh = data.keys.p256dh
        existing.auth = data.keys.auth
        existing.user_id = current_user.id
        db.commit()
        db.refresh(existing)
        return existing
    sub = models.AdminPushSubscription(
        endpoint=data.endpoint,
        p256dh=data.keys.p256dh,
        auth=data.keys.auth,
        user_id=current_user.id,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@router.post("/unsubscribe", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def admin_unsubscribe(
    request: Request,  # noqa: ARG001
    data: AdminPushSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Remove this admin's browser subscription (idempotent).

    Scoped to ``user_id`` so one admin cannot delete another's subscription
    (endpoints are opaque, but ownership is still enforced at the API layer,
    mirroring DEC-080's "separate store, integrity at the API layer").

    Deliberately POST, not DELETE: the backend client and several browser fetch
    stacks do not serialize bodies on DELETE, and the request carries the
    endpoint the way subscribe does (DEC-055, TASK-117 convention).
    """
    db.query(models.AdminPushSubscription).filter(
        models.AdminPushSubscription.endpoint == data.endpoint,
        models.AdminPushSubscription.user_id == current_user.id,
    ).delete()
    db.commit()
