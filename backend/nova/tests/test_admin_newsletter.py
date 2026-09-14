"""Admin newsletter-subscriber management contract tests (DEC-354, TASK-402).

DEC-351 shipped the guest newsletter (subscribe / confirm / unsubscribe +
new-post fan-out) but with no operator surface: an admin cannot see who is on
the list, how many are confirmed vs pending, or remove an address. That is a
real gap — a newsletter with no management is operationally broken (an address
subscribed by someone else, a dead mailbox, a subscriber asking to be removed
who lost their token). DEC-354 adds the admin surface.

Key properties:
- GET /api/admin/newsletter/subscribers requires an admin tier (401 anonymous,
  403 for an authenticated non-admin role); returns a paginated list (email,
  confirmed status, timestamps) with a confirmed/pending filter + literal
  case-insensitive email search (LIKE wildcards escaped) in a deterministic
  (created_at, id) descending order;
- DELETE /api/admin/newsletter/subscribers/{id} removes the row entirely
  (204); a missing id is 404; requires admin;
- the public endpoint surface (subscribe/confirm/unsubscribe) is untouched —
  admin operations are separate and additive.
"""

from email.message import EmailMessage

import pytest

from app import models


class FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording every delivered message."""

    instances: list[FakeSMTP] = []
    sent: list[EmailMessage] = []

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

    def send_message(self, msg: EmailMessage) -> None:
        FakeSMTP.sent.append(msg)


@pytest.fixture()
def smtp_sink(monkeypatch: pytest.MonkeyPatch) -> type[FakeSMTP]:
    """Configure SMTP against the fake sink and reset its capture per test."""
    FakeSMTP.instances = []
    FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    return FakeSMTP


def _subscribe(client, email: str) -> None:
    r = client.post("/api/newsletter/subscribe", json={"email": email})
    assert r.status_code == 202


def test_requires_admin(client):
    """Anonymous / non-admin calls are 401 (the list and the delete)."""
    assert client.get("/api/admin/newsletter/subscribers").status_code == 401
    assert client.delete("/api/admin/newsletter/subscribers/1").status_code == 401


def test_non_admin_role_rejected(client, db_session):
    """An authenticated account outside the admin tiers is 403 on list + delete.

    Mirrors the push-moderation guard test: a User whose role is not an admin
    tier gets 403 from get_current_admin (not 401 — they carried a valid token).
    """
    from app.auth import User, create_access_token, get_password_hash

    viewer = User(
        username="vieweronly",
        password=get_password_hash("pass12345"),
        role="viewer",
        is_superuser=False,
    )
    db_session.add(viewer)
    db_session.flush()
    token = create_access_token({"sub": viewer.id}, token_version=viewer.token_version or 0)
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/api/admin/newsletter/subscribers", headers=headers).status_code == 403
    assert client.delete("/api/admin/newsletter/subscribers/1", headers=headers).status_code == 403


def test_list_subscribers_filters_and_paginates(client, db_session, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    for email in ("a@example.com", "b@example.com", "c@example.com"):
        _subscribe(client, email)
    # Confirm two of the three so the status filter has something to split.
    subs = db_session.query(models.NewsletterSubscriber).order_by(models.NewsletterSubscriber.email).all()
    for sub in subs[:2]:
        sub.is_confirmed = True
    db_session.commit()

    # Unfiltered list shows all three, newest... email order for determinism.
    r = client.get("/api/admin/newsletter/subscribers", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["pagination"]["total"] == 3
    assert body["pagination"]["total_pages"] == 1
    assert {item["email"] for item in body["items"]} == {
        "a@example.com",
        "b@example.com",
        "c@example.com",
    }
    # Each row carries the confirmed flag + timestamps.
    item = next(i for i in body["items"] if i["email"] == "a@example.com")
    assert item["is_confirmed"] is True
    assert item["created_at"] is not None

    # Pagination ceil: limit=2 over 3 rows -> two pages, two rows on page 1.
    r = client.get(
        "/api/admin/newsletter/subscribers",
        headers=headers,
        params={"limit": 2},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["pagination"]["total"] == 3
    assert body["pagination"]["limit"] == 2
    assert body["pagination"]["total_pages"] == 2
    assert len(body["items"]) == 2

    # Status filter narrows.
    r = client.get(
        "/api/admin/newsletter/subscribers",
        headers=headers,
        params={"status": "pending"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["pagination"]["total"] == 1
    assert [i["email"] for i in body["items"]] == ["c@example.com"]

    r = client.get(
        "/api/admin/newsletter/subscribers",
        headers=headers,
        params={"status": "confirmed"},
    )
    assert r.status_code == 200
    assert r.json()["pagination"]["total"] == 2

    # Email search narrows case-insensitively.
    r = client.get(
        "/api/admin/newsletter/subscribers",
        headers=headers,
        params={"q": "B@EXAMPLE"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["pagination"]["total"] == 1
    assert body["items"][0]["email"] == "b@example.com"


def test_email_search_escapes_like_wildcards(client, admin_token):
    """Search terms match the literal substring — `%`/`_` in the term are
    escaped (readers-list convention, crud.escape_like_pattern). A raw `_`
    would also match `trickyxdup`; the escaped one finds only the address
    with a real underscore."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    _subscribe(client, "tricky_dup@example.com")
    _subscribe(client, "trickyxdup@example.com")

    r = client.get(
        "/api/admin/newsletter/subscribers",
        headers=headers,
        params={"q": "tricky_dup"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["pagination"]["total"] == 1
    assert body["items"][0]["email"] == "tricky_dup@example.com"


def test_admin_list_exposes_cadence(client, admin_token):
    """The admin list reports each subscriber's cadence so an operator can see
    why a confirmed address is NOT in the per-post fan-out (it opted into the
    weekly digest) — DEC-355."""
    client.post(
        "/api/newsletter/subscribe",
        json={"email": "weekly@example.com", "digest_weekly": True},
    )
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = client.get("/api/admin/newsletter/subscribers", headers=headers)
    assert r.status_code == 200
    item = next(i for i in r.json()["items"] if i["email"] == "weekly@example.com")
    assert item["digest_weekly"] is True


def test_list_rejects_invalid_query_params(client, admin_token):
    """Boundary-refusing query params are 422 (status pattern, q length/NUL,
    page/limit bounds)."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    cases = [
        {"status": "spam"},  # not confirmed|pending
        {"q": "x" * 300},  # longer than the 254-char cap
        {"limit": 101},  # above the page-size cap
        {"page": 0},  # pages are 1-based
        {"q": "ab\x00c"},  # NUL byte refused everywhere
    ]
    for params in cases:
        r = client.get("/api/admin/newsletter/subscribers", headers=headers, params=params)
        assert r.status_code == 422, f"{params!r} -> {r.status_code}"


def test_delete_removes_subscriber(client, db_session, admin_token):
    headers = {"Authorization": f"Bearer {admin_token}"}
    _subscribe(client, "gone@example.com")
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "gone@example.com")
        .one()
    )

    assert client.delete(f"/api/admin/newsletter/subscribers/{sub.id}", headers=headers).status_code == 204
    assert (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "gone@example.com")
        .first()
        is None
    )
    # A deleted / unknown id is 404 (idempotent removal can't be claimed twice).
    assert client.delete(f"/api/admin/newsletter/subscribers/{sub.id}", headers=headers).status_code == 404


def test_admin_delete_does_not_touch_public_surface(client, db_session, admin_token):
    """Admin delete is separate from the public unsubscribe: removing a row via
    admin removes the token too, so the public confirm/unsubscribe then answer
    404 for that token (indistinguishable from never-existed, no oracle)."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    client.post("/api/newsletter/subscribe", json={"email": "admin-delete@example.com"})
    sub = (
        db_session.query(models.NewsletterSubscriber)
        .filter(models.NewsletterSubscriber.email == "admin-delete@example.com")
        .one()
    )
    token = sub.token

    assert client.delete(f"/api/admin/newsletter/subscribers/{sub.id}", headers=headers).status_code == 204

    # Public confirm/unsubscribe against the now-removed row are 404.
    assert client.post("/api/newsletter/confirm", json={"token": token}).status_code == 404
    assert client.post("/api/newsletter/unsubscribe", json={"token": token}).status_code == 404
