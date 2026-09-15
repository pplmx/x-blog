"""Reader email-change with verification contract tests (DEC-357, TASK-404).

Account management is otherwise complete (display name, avatar, password
rotation, locale, data export, account delete) but the login email is
immutable with no verification flow, so a reader whose address changed is
stranded: per-event mail and the weekly digest go to the dead address and the
only "fix" is deleting the account (total data loss). This suite covers the
authenticated request (current password + new email, emailed verification link
to the NEW address) and the one-time token confirm (swap + revoke stale
sessions + auto-login), mirroring the password-reset contract.

Key properties:
- POST /api/reader/me/email/request requires auth (401 anonymous); verifies the
  current password (401 wrong), rejects the current email (400), rejects an
  address already used by another account (409, mirroring register), is 503
  when SMTP is unconfigured; otherwise 202 + a verification mail to the NEW
  address carrying a one-time link. Repeating the request replaces the
  previous pending change (single active flow).
- POST /api/reader/me/email/confirm needs no auth (the emailed link is the
  credential) and is one-time: it swaps the reader's email, clears the pending
  state, bumps token_version (revoking every pre-change session) and returns a
  fresh auto-login session. A second click / unknown / expired token is a 400
  (indistinguishable), and a target that got taken while pending is a 409.
"""

from datetime import timedelta

import pytest

from app import auth


class FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording every delivered message."""

    instances: list[FakeSMTP] = []
    sent: list = []

    def __init__(self, host: str, port: int, timeout: float | None = None):
        FakeSMTP.instances.append(self)

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def starttls(self, context: object = None) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        return None

    def send_message(self, msg) -> None:
        FakeSMTP.sent.append(msg)


def _register(client, email: str, password: str = "readerpass123"):
    r = client.post(
        "/api/reader/register",
        json={"email": email, "password": password, "display_name": "E2E Reader"},
    )
    assert r.status_code == 201
    return r.json()["access_token"]


def _verify_link(smtp_sink: type[FakeSMTP], address: str) -> str:
    """Extract the email-change verification link addressed to ``address``."""
    msg = next(m for m in smtp_sink.sent if m["To"] == address)
    for part in msg.walk():
        if part.get_content_type() == "text/plain":
            body = part.get_payload(decode=True).decode("utf-8", "replace")
            for tok in body.split():
                if tok.startswith("http") and "/email-change" in tok:
                    return tok.rstrip('.,"')
    raise AssertionError(f"no email-change link to {address}: {[m['To'] for m in smtp_sink.sent]}")


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _assert_not_persisted(db_session, email: str) -> None:
    """Assert the 503'd request left NO pending email-change state on disk.

    The app's request runs inside the SAME shared ``db_session`` (get_db
    override), so a 503 that never commits still leaves un-flushed token/
    pending attributes on the identity-mapped object. Expunging the session
    detaches that object, then the next query SELECTs the real transaction
    state — which is what the "nothing is persisted" contract is about."""
    db_session.expunge_all()
    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == email).one()
    assert acct.email_change_token is None
    assert acct.email_change_pending is None
    assert acct.email_change_requested_at is None



@pytest.fixture()
def smtp_sink(monkeypatch: pytest.MonkeyPatch) -> type[FakeSMTP]:
    """Point SMTP at the fake sink and reset its capture per test."""
    FakeSMTP.instances = []
    FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    return FakeSMTP


def test_request_requires_auth(client):
    """Anonymous / non-reader calls are 401 (the request is authenticated)."""
    assert (
        client.post(
            "/api/reader/me/email/request",
            json={"new_email": "new@example.com", "current_password": "x"},
        ).status_code
        == 401
    )
    assert client.post("/api/reader/me/email/confirm", json={"token": "x"}).status_code == 400


def test_request_rejects_wrong_password(client):
    token = _register(client, "alice@example.com")
    r = client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new@example.com", "current_password": "wrongpass"},
        headers=_bearer(token),
    )
    assert r.status_code == 401


def test_request_rejects_current_email_and_taken_email(client):
    first = _register(client, "first@example.com")
    _register(client, "second@example.com")

    # Same address as current is a 400 (nothing to change).
    r = client.post(
        "/api/reader/me/email/request",
        json={"new_email": "first@example.com", "current_password": "readerpass123"},
        headers=_bearer(first),
    )
    assert r.status_code == 400

    # An address already used by ANOTHER account is a 409 (mirroring register).
    r = client.post(
        "/api/reader/me/email/request",
        json={"new_email": "second@example.com", "current_password": "readerpass123"},
        headers=_bearer(first),
    )
    assert r.status_code == 409


def test_request_emails_verification_link_and_stores_pending(client, db_session, smtp_sink):
    token = _register(client, "alice@example.com")
    r = client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new-alice@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    assert r.status_code == 202
    assert r.json() == {"message": "A verification link is on its way to the new address"}

    # The mail went to the NEW address with the one-time link, not the old one.
    assert not any(m["To"] == "alice@example.com" for m in smtp_sink.sent)
    _verify_link(smtp_sink, "new-alice@example.com")

    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "alice@example.com").one()
    assert acct.email_change_pending == "new-alice@example.com"
    assert acct.email_change_token
    assert acct.email_change_requested_at is not None
    # The current email is unchanged and the old session still works.
    assert acct.email == "alice@example.com"
    assert client.get("/api/reader/me", headers=_bearer(token)).status_code == 200


def test_request_replaces_previous_pending(client, db_session, smtp_sink):
    token = _register(client, "alice@example.com")
    for new_email in ("try1@example.com", "try2@example.com"):
        r = client.post(
            "/api/reader/me/email/request",
            json={"new_email": new_email, "current_password": "readerpass123"},
            headers=_bearer(token),
        )
        assert r.status_code == 202
    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "alice@example.com").one()
    assert acct.email_change_pending == "try2@example.com"  # single active flow
    # Each request mails its own link to the new address; the last one is the
    # address that now holds the single active pending change.
    assert len(smtp_sink.sent) >= 2
    assert smtp_sink.sent[-1]["To"] == "try2@example.com"


def test_request_smtp_unconfigured_is_503(client, monkeypatch):
    token = _register(client, "alice@example.com")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    r = client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    assert r.status_code == 503


def test_confirm_swaps_email_and_revokes_stale_sessions(client, db_session, smtp_sink):
    token = _register(client, "alice@example.com")
    client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new-alice@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    link = _verify_link(smtp_sink, "new-alice@example.com")
    confirm_token = link.split("token=")[1]

    r = client.post("/api/reader/me/email/confirm", json={"token": confirm_token})
    assert r.status_code == 200
    body = r.json()
    assert body["reader"]["email"] == "new-alice@example.com"

    # The old session is revoked (token_version bumped); the fresh token works
    # and reports the new email.
    assert client.get("/api/reader/me", headers=_bearer(token)).status_code == 401
    fresh = client.get("/api/reader/me", headers=_bearer(body["access_token"]))
    assert fresh.status_code == 200
    assert fresh.json()["email"] == "new-alice@example.com"

    # Login with the NEW email + same password succeeds; the old email no longer
    # authenticates anything.
    assert (
        client.post(
            "/api/reader/login",
            json={"email": "new-alice@example.com", "password": "readerpass123"},
        ).status_code
        == 200
    )
    # Pending state fully cleared.
    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "new-alice@example.com").one()
    assert acct.email_change_token is None
    assert acct.email_change_pending is None
    assert acct.email_change_requested_at is None


def test_confirm_is_one_time_and_unknown_token_is_400(client, smtp_sink):
    token = _register(client, "alice@example.com")
    client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new-alice@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    link = _verify_link(smtp_sink, "new-alice@example.com")
    confirm_token = link.split("token=")[1]

    assert client.post("/api/reader/me/email/confirm", json={"token": confirm_token}).status_code == 200
    # A second click finds no pending token -> 400 (like password-reset confirm).
    assert client.post("/api/reader/me/email/confirm", json={"token": confirm_token}).status_code == 400
    # Unknown / malformed tokens -> 400.
    r = client.post("/api/reader/me/email/confirm", json={"token": "x" * 40})
    assert r.status_code == 400


def test_confirm_expired_link_is_400_and_clears_pending(client, db_session, smtp_sink):
    token = _register(client, "alice@example.com")
    client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new-alice@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    link = _verify_link(smtp_sink, "new-alice@example.com")
    confirm_token = link.split("token=")[1]

    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "alice@example.com").one()
    acct.email_change_requested_at = acct.email_change_requested_at - timedelta(minutes=61)
    db_session.commit()

    r = client.post("/api/reader/me/email/confirm", json={"token": confirm_token})
    assert r.status_code == 400
    # The stale pending state is cleared so a re-request starts clean.
    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "alice@example.com").one()
    assert acct.email_change_token is None
    assert acct.email_change_pending is None


def test_confirm_409_when_target_taken_while_pending(client, db_session, smtp_sink):
    token = _register(client, "alice@example.com")
    client.post(
        "/api/reader/me/email/request",
        json={"new_email": "sneaky@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    link = _verify_link(smtp_sink, "sneaky@example.com")
    confirm_token = link.split("token=")[1]

    # Someone else registers the target address while the link is pending.
    _register(client, "sneaky@example.com")

    r = client.post("/api/reader/me/email/confirm", json={"token": confirm_token})
    assert r.status_code == 409
    # The stale pending is cleared; the original account keeps its old email.
    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "alice@example.com").one()
    assert acct.email == "alice@example.com"
    assert acct.email_change_token is None


def test_request_send_refused_is_503_and_nothing_persisted(client, db_session, smtp_sink, monkeypatch):
    """A refused RFC-level send (e.g. the address provably bounces) is a 503 and
    nothing is staged — the docstring's core "nothing is persisted then" claim
    (round-342 review)."""
    token = _register(client, "alice@example.com")

    def _refuse(*_args, **_kwargs) -> bool:
        return False

    monkeypatch.setattr("app.routers.reader.emailer.send_email_change_email", _refuse)
    r = client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new-alice@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    assert r.status_code == 503
    _assert_not_persisted(db_session, "alice@example.com")
    assert not smtp_sink.sent  # no mail left the server


def test_request_send_exception_is_503_and_nothing_persisted(client, db_session, smtp_sink, monkeypatch):
    """A raising send (SMTP connection error) is a 503 and nothing is staged."""
    token = _register(client, "alice@example.com")

    def _boom(*_args, **_kwargs) -> bool:
        raise OSError("smtp down")

    monkeypatch.setattr("app.routers.reader.emailer.send_email_change_email", _boom)
    r = client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new-alice@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    assert r.status_code == 503
    _assert_not_persisted(db_session, "alice@example.com")
    assert not smtp_sink.sent


def test_confirm_old_link_after_rerequest_is_400(client, smtp_sink):
    """Re-requesting replaces the pending token, so the FIRST link is dead — its
    confirm answers 400 (single active flow), and only the newest link redeems."""
    token = _register(client, "alice@example.com")
    client.post(
        "/api/reader/me/email/request",
        json={"new_email": "try1@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    first = _verify_link(smtp_sink, "try1@example.com").split("token=")[1]
    client.post(
        "/api/reader/me/email/request",
        json={"new_email": "try2@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    second = _verify_link(smtp_sink, "try2@example.com").split("token=")[1]

    assert client.post("/api/reader/me/email/confirm", json={"token": first}).status_code == 400
    assert client.post("/api/reader/me/email/confirm", json={"token": second}).status_code == 200


def test_confirm_missing_requested_at_is_400_and_clears(client, db_session, smtp_sink):
    """A pending row with no request time is treated as expired: 400 + clear."""
    token = _register(client, "alice@example.com")
    client.post(
        "/api/reader/me/email/request",
        json={"new_email": "new-alice@example.com", "current_password": "readerpass123"},
        headers=_bearer(token),
    )
    link = _verify_link(smtp_sink, "new-alice@example.com")
    confirm_token = link.split("token=")[1]

    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "alice@example.com").one()
    acct.email_change_requested_at = None
    db_session.commit()

    r = client.post("/api/reader/me/email/confirm", json={"token": confirm_token})
    assert r.status_code == 400
    acct = db_session.query(auth.ReaderAccount).filter(auth.ReaderAccount.email == "alice@example.com").one()
    assert acct.email_change_token is None
    assert acct.email_change_pending is None
