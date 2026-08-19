"""Response security headers: defense-in-depth baseline for the JSON API.

The API never renders user HTML — it returns JSON and (in dev) the FastAPI
Swagger UI / ReDoc doc pages. So the CSP here is a conservative baseline, not
the strict nonce policy served by the Nuxt origin (frontend nitro middleware,
TASK-126) which does render user-supplied markdown/comments. ``'unsafe-inline'``
in ``script-src`` is required only so the CDN-hosted Swagger UI / ReDoc
bootstrap (with its inline config object) keeps loading; no user-controlled
script executes on this origin. Routes may still set a more specific header
(e.g. ``export.py`` pins ``X-Content-Type-Options``); the middleware only fills
headers that a route has not already set.
"""

from collections.abc import Callable

from starlette.requests import Request
from starlette.responses import Response

# Swagger UI (FastAPI /docs) bundles from jsdelivr; ReDoc bundles from jsdelivr
# and pulls Montserrat/Roboto from Google Fonts. Allow exactly those, plus the
# inline Swagger/ReDoc bootstrap and the fastapi tiangolo doc logo.
API_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' "
    "https://cdn.jsdelivr.net https://unpkg.com; "
    "style-src 'self' 'unsafe-inline' "
    "https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com; "
    "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; "
    "img-src 'self' data: https://fastapi.tiangolo.com; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)

SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": API_CONTENT_SECURITY_POLICY,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}


async def add_security_headers(request: Request, call_next: Callable) -> Response:
    """Apply the baseline security headers to every response.

    Uses ``setdefault`` so a route that deliberately sets a header (e.g. the
    CSV export's ``X-Content-Type-Options`` and ``Content-Disposition``) keeps
    its more specific value instead of being overwritten.
    """
    response = await call_next(request)
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response
