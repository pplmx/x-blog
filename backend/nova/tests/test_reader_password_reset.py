"""Reader password-reset contract tests (DEC-286, TASK-371).

The last reader self-service gap: a reader who forgot their password had no
recovery path (in-account change requires an existing session, DEC-067), and
password-reset was repeatedly deferred for "needs SMTP infra" — which DEC-197
built. This flow ships it as a stateless signed reset token + reset email.

Critical properties:
- POST /api/reader/password-reset/request always returns the *same* 202 for a
  known and an unknown email (no account-existence oracle); a 503 is only an
  infrastructure condition (SMTP unconfigured / send failed), also
  account-agnostic; only active accounts get mail, so deactivation state is
  never probed either.
- POST /api/reader/password-reset/confirm redeems a valid token: sets the new
  password (8..72), bumps token_version so all pre-change JWTs *and* the used
  reset token die, and returns a fresh reader session (auto-login).
- The reset token has its own audience: it can never be replayed as a reader
  credential, and an expired/wrong-audience/wrong-version token is a 400.
"""

import time
import urllib.parse
from email.message import EmailMessage

import jwt as pyjwt
import pytest

from app.auth import (
    ALGORITHM,
    READER_PASSWORD_RESET_AUDIENCE,
    SECRET_KEY,
)


class FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording every delivered message."""

    instances: list[FakeSMTP] = []
    sent: list[EmailMessage] = []

    def __init__(self, host: str, port: int, timeout: float | None = None):
        self.host = host
        self.port = port
        self.logged_in: tuple[str, str] | None = None
        self.tls_started = False
        FakeSMTP.instances.append(self)

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def starttls(self, context: object = None) -> None:
        self.tls_started = True

    def login(self, user: str, password: str) -> None:
        self.logged_in = (user, password)

    def send_message(self, msg: EmailMessage) -> None:
        FakeSMTP.sent.append(msg)


@pytest.fixture()
def smtp_sink(monkeypatch):
    """Configure SMTP against the fake sink and reset its capture per test."""
    FakeSMTP.instances = []
    FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    monkeypatch.setenv("SMTP_FROM", "blog@example.com")
    monkeypatch.setenv("SITE_URL", "https://blog.example.com")
    return FakeSMTP


def _register(client, email="reset@example.com", password="readerpass123"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


def _request(client, email, **extra):
    return client.post("/api/reader/password-reset/request", json={"email": email, **extra})


def _confirm(client, token, new_password="newpass456", **extra):
    return client.post(
        "/api/reader/password-reset/confirm",
        json={"token": token, "new_password": new_password, **extra},
    )


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _reset_link() -> str | None:
    """The reset URL from the single captured email (text part), or None."""
    if not FakeSMTP.sent:
        return None
    msg = FakeSMTP.sent[-1]
    text = next(p for p in msg.walk() if p.get_content_type() == "text/plain").get_content()
    for line in text.splitlines():
        if "https://" in line:
            return line.strip()
    return None


def _token_from_link() -> str | None:
    link = _reset_link()
    if not link:
        return None
    return urllib.parse.parse_qs(urllib.parse.urlparse(link).query).get("token", [None])[0]


class TestRequest:
    def test_known_email_sends_one_reset_mail(self, client, smtp_sink):
        _register(client)
        resp = _request(client, "RESET@example.com")  # case-insensitive lookup
        assert resp.status_code == 202, resp.text
        assert len(FakeSMTP.sent) == 1
        assert FakeSMTP.sent[0]["To"] == "reset@example.com"
        # The reset page deep link carries the token.
        assert "/reset-password?token=" in _reset_link()

    def test_unknown_email_is_identical_202_and_no_mail(self, client, smtp_sink):
        resp = _request(client, "nobody@example.com")
        assert resp.status_code == 202, resp.text
        assert len(FakeSMTP.sent) == 0

    def test_case_insensitive_lookup(self, client, smtp_sink):
        _register(client, email="Mixed@Example.com")
        resp = _request(client, "mIXeD@example.COM")
        assert resp.status_code == 202
        assert len(FakeSMTP.sent) == 1
        assert FakeSMTP.sent[0]["To"] == "mixed@example.com"

    def test_deactivated_reader_gets_no_mail_but_same_202(self, client, smtp_sink, db_session):
        _register(client)
        from app.auth import ReaderAccount

        reader = db_session.query(ReaderAccount).filter_by(email="reset@example.com").first()
        assert reader is not None
        reader.is_active = False
        db_session.commit()
        resp = _request(client, "reset@example.com")
        assert resp.status_code == 202, resp.text
        assert len(FakeSMTP.sent) == 0  # no mail, same generic response

    def test_missing_smtp_config_is_account_agnostic_503(self, client, monkeypatch):
        monkeypatch.delenv("SMTP_HOST", raising=False)
        _register(client)
        known = _request(client, "reset@example.com")
        assert known.status_code == 503
        unknown = _request(client, "ghost@example.com")
        assert unknown.status_code == 503
        # Identical error detail — the 503 reveals config, never account state.
        assert known.json()["error"]["message"] == unknown.json()["error"]["message"]

    def test_invalid_email_is_422(self, client):
        resp = _request(client, "not-an-email")
        assert resp.status_code == 422


class TestConfirm:
    def test_valid_token_sets_new_password_and_auto_logs_in(self, client, smtp_sink):
        reg = _register(client)
        old_token = reg.json()["access_token"]
        _request(client, "reset@example.com")
        reset_token = _token_from_link()
        assert reset_token

        resp = _confirm(client, reset_token)
        assert resp.status_code == 200, resp.text
        fresh = resp.json()["access_token"]
        assert resp.json()["reader"]["email"] == "reset@example.com"

        # New password works; old is dead.
        assert (
            client.post("/api/reader/login", json={"email": "reset@example.com", "password": "newpass456"}).status_code
            == 200
        )
        assert (
            client.post(
                "/api/reader/login", json={"email": "reset@example.com", "password": "readerpass123"}
            ).status_code
            == 401
        )
        # Pre-reset reader JWT revoked (token_version bump); fresh session works.
        assert client.get("/api/reader/me", headers=_auth(old_token)).status_code == 401
        assert client.get("/api/reader/me", headers=_auth(fresh)).status_code == 200

    def test_reset_token_is_single_use(self, client, smtp_sink):
        _register(client)
        _request(client, "reset@example.com")
        reset_token = _token_from_link()
        assert _confirm(client, reset_token).status_code == 200
        # Replaying the same token after success is a 400 (ver no longer matches).
        replay = _confirm(client, reset_token, new_password="another456")
        assert replay.status_code == 400
        # The password from the first reset is untouched.
        assert (
            client.post(
                "/api/reader/login", json={"email": "reset@example.com", "password": "readerpass123"}
            ).status_code
            == 401
        )
        assert (
            client.post("/api/reader/login", json={"email": "reset@example.com", "password": "newpass456"}).status_code
            == 200
        )

    def test_expired_token_rejected(self, client, smtp_sink):
        _register(client)
        expired = pyjwt.encode(
            {
                "sub": "1",
                "ver": 0,
                "aud": READER_PASSWORD_RESET_AUDIENCE,
                "exp": int(time.time()) - 60,
            },
            SECRET_KEY,
            algorithm=ALGORITHM,
        )
        resp = _confirm(client, expired)
        assert resp.status_code == 400, resp.text
        assert "Invalid or expired" in resp.json()["error"]["message"]

    def test_tampered_token_rejected(self, client, smtp_sink):
        _register(client)
        resp = _confirm(client, "not.a.real.token")
        assert resp.status_code == 400
        assert "Invalid or expired" in resp.json()["error"]["message"]

    def test_reader_jwt_cannot_redeem_as_reset(self, client, smtp_sink):
        """A reader JWT (aud=x-blog-reader) must never unlock a password reset."""
        reg = _register(client)
        reader_token = reg.json()["access_token"]
        resp = _confirm(client, reader_token)
        assert resp.status_code == 400

    def test_reset_token_cannot_auth_as_reader(self, client, smtp_sink):
        """The reset token's own audience keeps it off /api/reader/me."""
        _register(client)
        _request(client, "reset@example.com")
        reset_token = _token_from_link()
        assert client.get("/api/reader/me", headers=_auth(reset_token)).status_code == 401

    def test_new_password_validation(self, client, smtp_sink):
        _register(client)
        _request(client, "reset@example.com")
        reset_token = _token_from_link()
        too_short = _confirm(client, reset_token, new_password="short")
        assert too_short.status_code == 422
        too_long = _confirm(client, reset_token, new_password="x" * 73)
        assert too_long.status_code == 422
