"""Shared rate limiter instance for the application."""

import ipaddress
import os

from slowapi import Limiter
from starlette.requests import Request

# Rate limit per minute, configurable via environment
RATE_LIMIT_READ = os.getenv("RATE_LIMIT_READ_PER_MINUTE", "120")
RATE_LIMIT_WRITE = os.getenv("RATE_LIMIT_WRITE_PER_MINUTE", "30")
RATE_LIMIT_AUTH = os.getenv("RATE_LIMIT_AUTH_PER_MINUTE", "10")
# Stricter than login: open reader signup is the classic spam/abuse surface, so
# account creation gets a tight per-IP bucket. (DEC-059, TASK-131)
RATE_LIMIT_REGISTER = os.getenv("RATE_LIMIT_REGISTER_PER_MINUTE", "5")
RATE_LIMIT_SEARCH = os.getenv("RATE_LIMIT_SEARCH_PER_MINUTE", "60")
RATE_LIMIT_COMMENT = os.getenv("RATE_LIMIT_COMMENT_PER_MINUTE", "20")
RATE_LIMIT_EXPORT = os.getenv("RATE_LIMIT_EXPORT_PER_MINUTE", "10")


def _xff_client(xff: str) -> str | None:
    """The original client IP from an X-Forwarded-For entry, or None.

    ``XFF`` is written by the trusted proxy but the header itself is
    client-supplied, so a forged entry can be any string — a 5000-char line
    (VARCHAR overflow -> DataError -> 500 on the ``ip_address``/``ip_key``
    columns *and* a malformed rate-limit key) or a chosen literal that spoofs
    someone else's bucket (round-17 security review, TASK-351).

    Only trust the entry when it is a genuinely well-formed IP literal:
    ``ipaddress`` canonicalizes it (bounded, always ≤ 45 chars — comfortably
    inside the VARCHAR(50) columns), dedupes equivalent spellings of the same
    IPv6/4-mapped address, and rejects anything non-IP outright. Returns None
    for garbage so the caller can fall back to the peer.

    RFC 7239 nodes may carry a port (``203.0.113.9:8080``,
    ``[2001:db8::1]:443``) — nginx/frps/ingres add the client port when the
    client connected to the proxy over a distinct source port. Strip it before
    validation so a port-carrying entry is still recognized (its bare host is
    canonical, bounded, and deduped); otherwise it would fall back to the
    proxy peer and collapse every proxied client into one shared bucket.
    """
    token = xff.split(",")[0].strip()
    if not token:
        return None
    candidates = [token]
    if token.startswith("["):
        # [IPv6] or [IPv6]:port — the bracketed form can hold the bare address.
        end = token.find("]")
        if end == -1:
            return None
        candidates.append(token[1:end])
    else:
        # A trailing :port (only possible for v4-unbraced tokens; a bare IPv6
        # has colons throughout and validates on the first candidate).
        head, sep, _tail = token.rpartition(":")
        if sep:
            candidates.append(head)
    for cand in candidates:
        try:
            return str(ipaddress.ip_address(cand))
        except ValueError:
            continue
    return None


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
      leftmost X-Forwarded-For entry — which is the original client per RFC 7239
      — but only when it is a well-formed IP literal (see ``_xff_client``); a
      non-IP entry is forged, so it falls back to the peer instead of being
      stored/spoofed (round-17 security review, TASK-351).
    """
    peer = request.client.host if request.client else "unknown"
    xff = request.headers.get("x-forwarded-for", "").strip()
    if not xff:
        return peer
    trusted = os.getenv("TRUSTED_PROXIES", "").strip()
    if trusted == "*" or peer in {p.strip() for p in trusted.split(",") if p.strip()}:
        return _xff_client(xff) or peer
    return peer


# Shared limiter instance — import this in routers and main.py
limiter = Limiter(key_func=client_rate_key)
