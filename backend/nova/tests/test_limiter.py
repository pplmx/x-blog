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


def test_trusted_peer_forged_xff_not_an_ip_falls_back_to_peer(monkeypatch):
    """A trusted-proxy XFF entry that is not a real IP is forged (client
    supplies the header; only the proxy's presence is trusted): it must not
    become the rate-limit key -- it would be a spoofable fresh bucket and an
    unbounded string that overflows the VARCHAR(50) ip_address/ip_key columns
    (round-17 security review, TASK-351)."""
    monkeypatch.setenv("TRUSTED_PROXIES", "*")
    assert client_rate_key(_req("10.0.0.5", "not-an-ip")) == "10.0.0.5"
    assert client_rate_key(_req("10.0.0.5", "garbage" * 100)) == "10.0.0.5"


def test_trusted_peer_garbage_xff_chain_falls_back_to_peer(monkeypatch):
    """Multiple forged entries before a real-looking one are still garbage."""
    monkeypatch.setenv("TRUSTED_PROXIES", "*")
    assert client_rate_key(_req("10.0.0.5", "spam,spam,spam")) == "10.0.0.5"


def test_trusted_peer_xff_canonicalizes_ipv4_ipv6(monkeypatch):
    """Real IP literals are canonicalized (bounded, dedup of equivalent forms)
    — the form persisted to ip_address/ip_key columns."""
    monkeypatch.setenv("TRUSTED_PROXIES", "*")
    assert client_rate_key(_req("10.0.0.1", "192.0.2.9")) == "192.0.2.9"
    assert client_rate_key(_req("10.0.0.1", "2001:db8::1")) == "2001:db8::1"
    assert client_rate_key(_req("10.0.0.1", "::ffff:192.0.2.9")) == "::ffff:192.0.2.9"
