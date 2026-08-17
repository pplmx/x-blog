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

from pywebpush import WebPushException, webpush


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
) -> None:
    """Deliver ``payload`` to one subscription via the Web Push protocol.

    Raises ``WebPushException`` on any failure (including a 410/404 from the
    push service, which the caller uses to retire a dead subscription).
    """
    webpush(
        subscription_info={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
        data=json.dumps(payload, ensure_ascii=False),
        vapid_private_key=vapid_private_key(),
        vapid_claims={"sub": vapid_subject()},
        ttl=ttl,
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
