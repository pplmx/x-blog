"""Shared rate limiter instance for the application."""

import os

from slowapi import Limiter
from starlette.requests import Request

# Rate limit per minute, configurable via environment
RATE_LIMIT_READ = os.getenv("RATE_LIMIT_READ_PER_MINUTE", "120")
RATE_LIMIT_WRITE = os.getenv("RATE_LIMIT_WRITE_PER_MINUTE", "30")
RATE_LIMIT_AUTH = os.getenv("RATE_LIMIT_AUTH_PER_MINUTE", "10")
RATE_LIMIT_SEARCH = os.getenv("RATE_LIMIT_SEARCH_PER_MINUTE", "60")
RATE_LIMIT_COMMENT = os.getenv("RATE_LIMIT_COMMENT_PER_MINUTE", "20")
RATE_LIMIT_EXPORT = os.getenv("RATE_LIMIT_EXPORT_PER_MINUTE", "10")


def client_rate_key(request: Request) -> str:
    """Rate-limit key: the caller's real IP when it is knowable, else the peer.

    Slowapi's default ``get_remote_address`` returns only ``request.client.host``
    — the immediate TCP peer. Behind a single proxy (the Nuxt same-origin API
    proxy, or nginx) every client then collapses into one shared 429 bucket,
    and per-client abuse protection is lost (round-16 security audit).

    This resolver:

    * keeps that default (peer) when there is no X-Forwarded-For, or the peer
      is NOT a trusted proxy — so a direct client cannot spoof a fresh bucket
      by sending an X-Forwarded-For header;
    * only when the peer is trusted (``TRUSTED_PROXIES`` = comma-separated IPs,
      or ``*`` to trust any peer, e.g. a single-gateway dev topology) uses the
      leftmost X-Forwarded-For entry, which is the original client per RFC 7239.
    """
    peer = request.client.host if request.client else "unknown"
    xff = request.headers.get("x-forwarded-for", "").strip()
    if not xff:
        return peer
    trusted = os.getenv("TRUSTED_PROXIES", "").strip()
    if trusted == "*" or peer in {p.strip() for p in trusted.split(",") if p.strip()}:
        return xff.split(",")[0].strip() or peer
    return peer


# Shared limiter instance — import this in routers and main.py
limiter = Limiter(key_func=client_rate_key)
