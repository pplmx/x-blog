"""Web Push (RFC 8030) configuration and delivery helpers.

The blog subscribes readers' browsers via the Web Push protocol: the browser
registers against a vendor push service (FCM/Web Push protocol) and hands the
server an ``endpoint`` plus ``p256dh``/``auth`` encryption keys. The server
signs a VAPID JWT (ES256) so the push service accepts messages on the
subscriber's behalf, and encrypts the (JSON) payload with http-ece so only that
browser can read it.

VAPID keys are ES256 (P-256): the operator generates a keypair once and
provides the two halves as base64url-encoded env vars. The public half is the
65-byte uncompressed point (the ``applicationServerKey`` passed to
``pushManager.subscribe`` in the browser); the private half is the 32-byte raw
scalar used to sign the VAPID token.

All reads are lazy (per-call, not at import) so tests can vary the
configuration and a partially-configured deployment — exactly one of the two
key env vars set — fails closed instead of silently pushing with only half a
key. (DEC-055, TASK-117)
"""

import base64
import json
import os
from typing import Any

from pywebpush import webpush
from sqlalchemy import or_

from app import models
from app.auth import User  # noqa: F401 — moderation fan-out targets admins (User, not ReaderAccount)


def _b64url_decode(value: str) -> bytes | None:
    """Decode a base64url string (padding optional), None if malformed."""
    try:
        padded = value + "=" * ((4 - len(value) % 4) % 4)
        return base64.urlsafe_b64decode(padded)
    except ValueError, TypeError:
        return None


def vapid_public_key() -> str | None:
    """The base64url 65-byte uncompressed EC point, or None when unconfigured."""
    return os.getenv("VAPID_PUBLIC_KEY") or None


def vapid_private_key() -> str | None:
    """The base64url 32-byte private scalar, or None when unconfigured."""
    return os.getenv("VAPID_PRIVATE_KEY") or None


def vapid_subject() -> str:
    """VAPID ``sub`` claim identifying the operator (mailto: or https URL)."""
    return os.getenv("VAPID_SUBJECT", "mailto:admin@x-blog.local")


def vapid_configured() -> bool:
    """Both halves of the keypair are present (fail closed on partial config)."""
    return bool(vapid_public_key() and vapid_private_key())


def send_push(
    *,
    endpoint: str,
    p256dh: str,
    auth: str,
    payload: dict[str, Any],
    ttl: int = 300,
    timeout: float = 10.0,
) -> None:
    """Deliver ``payload`` to one subscription via the Web Push protocol.

    Raises ``WebPushException`` on any failure (including a 410/404 from the
    push service, which the caller uses to retire a dead subscription).

    ``timeout`` bounds each endpoint's connect/read so a single dead or
    unreachable push service cannot stall a whole broadcast (without it,
    requests has no timeout and a hanging endpoint eats the app's 30s request
    budget, turning the admin notify into a 504).
    """
    webpush(
        subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=vapid_private_key(),
        vapid_claims={"sub": vapid_subject()},
        ttl=ttl,
        timeout=timeout,
    )


def push_removed_status(exc: BaseException) -> int | None:
    """Return the push service status when the subscription is dead, else None.

    A 410/404 means the endpoint no longer exists on the push service (browser
    uninstalled, user cleared site data) — the caller should delete its row.
    Only pywebpush's ``WebPushException`` carries a ``.response``; any other
    error (network, timeout) has no HTTP status, so this returns None.
    """
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    return status if status in (404, 410) else None


def dispatch_to_subscriptions(
    subscriptions,
    payload: dict[str, Any],
    db,
    logger,
) -> dict[str, int]:
    """Send ``payload`` to a set of subscriptions, retiring dead ones.

    Shared by the superuser broadcast and targeted reader notifications: sends
    to each endpoint, treats 404/410 as "subscription gone" (deletes the row,
    stays invisible to the caller), and tolerates individual failures so one
    dead endpoint cannot fail the whole dispatch or the triggering request.
    """
    sent = failed = removed = 0
    for sub in subscriptions:
        try:
            send_push(endpoint=sub.endpoint, p256dh=sub.p256dh, auth=sub.auth, payload=payload)
            sent += 1
        except Exception as exc:  # noqa: BLE001 — pywebpush raises typed+untyped per endpoint
            removed_status = push_removed_status(exc)
            if removed_status is not None and db is not None:
                db.delete(sub)
                removed += 1
                logger.warning(
                    "push_subscription_gone",
                    extra={"endpoint": sub.endpoint, "status": removed_status},
                )
            else:
                failed += 1
                logger.warning(
                    "push_dispatch_failed",
                    extra={"endpoint": sub.endpoint, "error": str(exc)[:300]},
                )
    if db is not None:
        db.commit()
    return {"sent": sent, "failed": failed, "removed": removed}


# New-post notification copy (server-generated push, so not i18n-able per
# browser; operators can localize via env). Defaults match the zh-first site.
POST_NOTIF_TITLE = os.getenv("POST_NOTIFICATION_TITLE", "新文章发布")
POST_NOTIF_BODY = os.getenv("POST_NOTIFICATION_BODY", "《{post_title}》")


def dispatch_new_post(db, post: models.Post, logger) -> dict[str, int]:
    """Push 'a new post was published' to opted-in subscriptions.

    Target: every subscription with ``want_new_posts`` whose scope matches the
    post — a subscription pinned to a category receives only that category's
    posts; an all-posts subscription (``new_post_category_id`` NULL) receives
    everything. A post without a category only reaches all-posts subscribers.
    Best effort: unconfigured VAPID or no matches is a silent no-op, and the
    shared dispatch helper retires dead (404/410) endpoints without failing the
    publish. Callers fire this only after a write makes the post immediately
    visible (published, publish_at == None or passed) — scheduled (future
    publish_at) posts are not notified until they are actually published by a
    later write (this blog has no background scheduler today, DEC-076).
    """
    if not vapid_configured():
        return {"sent": 0, "failed": 0, "removed": 0}
    payload = {
        "title": POST_NOTIF_TITLE,
        # replace (not .format) so a { } in the post title can't raise and
        # break the publish — this path must stay best-effort.
        "body": POST_NOTIF_BODY.replace("{post_title}", post.title or ""),
        "url": f"/posts/{post.slug}",
    }
    # Standard new-post recipients, deduped by push endpoint.
    query = db.query(models.PushSubscription).filter(models.PushSubscription.want_new_posts.is_(True))
    if post.category_id is not None:
        query = query.filter(
            or_(
                models.PushSubscription.new_post_category_id.is_(None),
                models.PushSubscription.new_post_category_id == post.category_id,
            )
        )
    else:
        query = query.filter(models.PushSubscription.new_post_category_id.is_(None))
    by_endpoint = {sub.endpoint: sub for sub in query.all()}

    # Also notify readers who follow this post's series ('new part' push,
    # DEC-132/TASK-178): any of their PushSubscriptions receive the same
    # notification. Unioned by endpoint so a series follower who also opted
    # into all/category new-post push gets exactly one notification.
    if post.series_id is not None:
        follower_reader_ids = [
            row.reader_id
            for row in db.query(models.SeriesFollow.reader_id)
            .filter(
                models.SeriesFollow.series_id == post.series_id,
                models.SeriesFollow.notify.is_(True),
            )
            .all()
        ]
        if follower_reader_ids:
            for sub in (
                db.query(models.PushSubscription)
                .filter(models.PushSubscription.reader_id.in_(follower_reader_ids))
                .all()
            ):
                by_endpoint[sub.endpoint] = sub

    # Also notify readers who follow this post's category with notifications
    # on (DEC-140/TASK-182): durable reader-level intent, distinct from the
    # per-device new-post category pin. Unioned by endpoint so a category
    # follower already reached via all/category new-post push gets one push.
    if post.category_id is not None:
        cat_follower_reader_ids = [
            row.reader_id
            for row in db.query(models.CategoryFollow.reader_id)
            .filter(
                models.CategoryFollow.category_id == post.category_id,
                models.CategoryFollow.notify.is_(True),
            )
            .all()
        ]
        if cat_follower_reader_ids:
            for sub in (
                db.query(models.PushSubscription)
                .filter(models.PushSubscription.reader_id.in_(cat_follower_reader_ids))
                .all()
            ):
                by_endpoint[sub.endpoint] = sub

    if not by_endpoint:
        return {"sent": 0, "failed": 0, "removed": 0}
    return dispatch_to_subscriptions(list(by_endpoint.values()), payload, db, logger)


# Moderation-alert notification copy (server-generated push, so not i18n-able
# per browser; operators can localize via env). The blog moderates every comment
# and the author's only discovery path was re-opening the moderation queue —
# this push tells them a new comment is waiting, with a short preview so they
# can judge it before opening the queue. (DEC-080)
MODERATION_NOTIF_TITLE = os.getenv("MODERATION_NOTIFICATION_TITLE", "新评论待审核")
MODERATION_NOTIF_BODY = os.getenv(
    "MODERATION_NOTIFICATION_BODY",
    "《{post_title}》有新的待审评论：{nickname}：{excerpt}",
)


def dispatch_moderation_pending(db, post: models.Post, comment, logger) -> dict[str, int]:
    """Push 'a new comment awaits moderation' to opted-in admin accounts.

    Fired when a comment is CREATED (every comment starts pending in this blog —
    no auto-approve, DEC-066). Target: every admin (superuser or editor,
    DEC-054) who opted this browser in via /api/admin/push/subscribe. Consumer
    is the blog operator, whose one-sided push arc until now only went
    reader-ward (reply/new-post/thread, DEC-064/076/078).

    Deliberately queries ``AdminPushSubscription`` (not ``PushSubscription``):
    the two tables are separated so a moderation push can never leak into the
    reader fan-outs, mirroring the User/ReaderAccount audience separation
    (DEC-059). Best effort — unconfigured VAPID or no subscriptions is a silent
    no-op, and the shared dispatch helper retires dead (404/410) endpoints
    without failing the comment create (DEC-080).
    """
    if not vapid_configured():
        return {"sent": 0, "failed": 0, "removed": 0}
    subscriptions = (
        db.query(models.AdminPushSubscription)
        .join(User, User.id == models.AdminPushSubscription.user_id)
        .filter(User.role.in_(("superuser", "editor")))
        .all()
    )
    if not subscriptions:
        return {"sent": 0, "failed": 0, "removed": 0}
    # A short single-line preview (commenter + up to 60 chars of content,
    # whitespace-collapsed) so the author can judge the comment before opening
    # the queue. Truncation keeps the os.environ override simple; replace (not
    # .format) so { } in user content can never raise and break the create.
    nickname = str(comment.nickname or "").strip()[:20]
    excerpt = " ".join(str(comment.content or "").split())[:60]
    payload = {
        "title": MODERATION_NOTIF_TITLE,
        "body": (
            MODERATION_NOTIF_BODY.replace("{post_title}", post.title or "")
            .replace("{nickname}", nickname)
            .replace("{excerpt}", excerpt)
        ),
        # Deep-link to the moderation queue (the admin comments page defaults
        # to the "all" filter and highlights pending comments).
        "url": "/admin/comments",
    }
    return dispatch_to_subscriptions(subscriptions, payload, db, logger)
