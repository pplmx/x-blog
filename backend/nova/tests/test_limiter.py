"""Unit tests for the trusted-proxy-aware rate-limit key resolver."""

from starlette.requests import Request

from app.limiter import client_rate_key


def _req(peer_ip: str | None, xff: str | None) -> Request:
    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "scheme": "http",
        "server": ("test", 80),
        "client": (peer_ip, 0) if peer_ip else None,
        "headers": headers,
    }
    return Request(scope)


def test_no_xff_uses_peer(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "*")
    assert client_rate_key(_req("1.2.3.4", None)) == "1.2.3.4"


def test_untrusted_peer_xff_ignored(monkeypatch):
    """Without TRUSTED_PROXIES a client cannot fake a fresh bucket via a forged header."""
    monkeypatch.delenv("TRUSTED_PROXIES", raising=False)
    assert client_rate_key(_req("1.2.3.4", "203.0.113.9")) == "1.2.3.4"


def test_trust_all_xff_used(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "*")
    assert client_rate_key(_req("10.0.0.5", "203.0.113.9, 10.0.0.1")) == "203.0.113.9"


def test_trusted_specific_peer_xff_used(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "10.0.0.5,10.0.0.6")
    assert client_rate_key(_req("10.0.0.5", "203.0.113.9")) == "203.0.113.9"


def test_other_untrusted_peer_still_ignored(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "10.0.0.5")
    assert client_rate_key(_req("10.0.0.7", "203.0.113.9")) == "10.0.0.7"
