"""Guest comment management via emailed token (round 385, DEC-435/TASK-444).

An anonymous commenter who accepts the reply email consent gets a per-comment
secret token (DEC-332) that is only ever delivered by mail. Before this round
it existed solely to flip ``reply_notify_email`` off; now the same token gates
comment edit/delete (GET/PATCH/DELETE /api/comments/manage) so a guest can fix
a typo or withdraw a comment without an account. These tests cover the router
contract: token ownership (wrong token = 404, no id enumeration), the edit
moderation reset, the delete reparenting, and the approval-time manage email
fired to the guest's stored address.
"""

from email.message import EmailMessage

import pytest

from app import models


@pytest.fixture(scope="function")
def post(client, auth_headers):
    response = client.post(
        "/api/posts",
        json={
            "title": "Guest Manage Post",
            "slug": "guest-manage-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    return response.json()


class _FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording delivered messages (mirrors the
    emailer/digest suites' sink so all channels assert identically)."""

    instances: list[_FakeSMTP] = []
    sent: list[EmailMessage] = []

    def __init__(self, host: str, port: int, timeout: float | None = None):
        self.host = host
        self.port = port
        _FakeSMTP.instances.append(self)

    def __enter__(self) -> _FakeSMTP:
        return self

    def __exit__(self, *exc) -> None:
        return None

    def starttls(self, context: object = None) -> None:
        return None

    def login(self, user: str, password: str) -> None:
        return None

    def send_message(self, msg: EmailMessage) -> None:
        _FakeSMTP.sent.append(msg)


@pytest.fixture
def smtp_sink(monkeypatch: pytest.MonkeyPatch):
    """Point emailer's smtplib at the fake sink; lazy env config mirrors the
    emailer suites."""
    _FakeSMTP.instances = []
    _FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", _FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    monkeypatch.setenv("SMTP_FROM", "blog@example.com")
    monkeypatch.setenv("SITE_URL", "https://blog.example.com")
    return _FakeSMTP


def _text_part(msg: EmailMessage) -> str:
    for part in msg.walk():
        if part.get_content_type() == "text/plain":
            return part.get_content()
    return ""


def _create_consenting_comment(client, post_id: int, content: str = "a guest comment") -> int:
    """Create an anonymous comment that consents to the reply email (the only
    way a guest gets a token) and return its id."""
    resp = client.post(
        f"/api/comments/post/{post_id}",
        json={
            "nickname": "Guest Lee",
            "email": "guest@example.com",
            "content": content,
            "reply_notify_email": True,
        },
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _token_for(db_session, comment_id: int) -> str:
    token = db_session.get(models.Comment, comment_id).reply_notify_token
    assert token, "consenting anonymous comment must have a token"
    return token


def test_consenting_comment_gets_a_token_but_does_not_leak_it(client, post, db_session):
    comment_id = _create_consenting_comment(client, post["id"])
    token = _token_for(db_session, comment_id)
    assert len(token) >= 32  # secrets.token_urlsafe(32)
    # The token is a secret: it must never ride a public API response.
    listed = client.get(f"/api/comments/post/{post['id']}").json()
    for comment in listed["items"]:
        assert "reply_notify_token" not in comment
        assert "token" not in comment


def test_get_manage_requires_a_token(client):
    assert client.get("/api/comments/manage").status_code == 422
    assert client.get("/api/comments/manage?token=").status_code == 422


def test_get_manage_unknown_token_is_404(client):
    assert client.get("/api/comments/manage?token=" + "x" * 64).status_code == 404


def test_get_manage_returns_comment_and_post(client, post, db_session):
    comment_id = _create_consenting_comment(client, post["id"])
    token = _token_for(db_session, comment_id)
    resp = client.get(f"/api/comments/manage?token={token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["comment"]["id"] == comment_id
    assert data["comment"]["content"] == "a guest comment"
    assert data["comment"]["is_approved"] is False  # pending until moderated
    assert data["post"]["id"] == post["id"]
    assert data["post"]["slug"] == post["slug"]


def test_edit_manage_with_own_token_updates_content_and_resets_approval(client, post, db_session, auth_headers):
    comment_id = _create_consenting_comment(client, post["id"])
    token = _token_for(db_session, comment_id)
    # First get the comment approved so the edit's moderation-reset is visible.
    approve = client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert approve.status_code == 200
    assert approve.json()["is_approved"] is True

    resp = client.patch("/api/comments/manage", json={"token": token, "content": "fixed typo"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == comment_id
    assert data["content"] == "fixed typo"
    # Editing replaces public content -> must re-enter the moderation queue.
    assert data["is_approved"] is False
    assert data["edited_at"] is not None
    assert data["nickname"] == "Guest Lee"


def test_edit_manage_whitespace_only_content_is_422(client, post, db_session):
    comment_id = _create_consenting_comment(client, post["id"])
    token = _token_for(db_session, comment_id)
    resp = client.patch("/api/comments/manage", json={"token": token, "content": "   "})
    assert resp.status_code == 422


def test_edit_manage_unknown_token_is_404(client):
    assert client.patch("/api/comments/manage", json={"token": "z" * 64, "content": "hi"}).status_code == 404


def test_edit_manage_does_not_touch_other_comments(client, post, db_session):
    a_id = _create_consenting_comment(client, post["id"], "comment A")
    b_id = _create_consenting_comment(client, post["id"], "comment B")
    token_a = _token_for(db_session, a_id)
    client.patch("/api/comments/manage", json={"token": token_a, "content": "A edited"})
    b = db_session.get(models.Comment, b_id)
    assert b.content == "comment B"
    assert b.edited_at is None


def test_delete_manage_with_own_token_removes_comment(client, post, db_session, auth_headers):
    comment_id = _create_consenting_comment(client, post["id"])
    token = _token_for(db_session, comment_id)
    client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    resp = client.delete(f"/api/comments/manage?token={token}")
    assert resp.status_code == 204
    assert db_session.get(models.Comment, comment_id) is None
    # Gone from the public list too (approved count back to 0).
    listed = client.get(f"/api/comments/post/{post['id']}").json()
    assert listed["items"] == []


def test_delete_manage_unknown_token_is_404(client):
    assert client.delete("/api/comments/manage?token=" + "y" * 64).status_code == 404


def test_approval_emails_consenting_guest_a_manage_link(client, post, db_session, auth_headers, smtp_sink):
    comment_id = _create_consenting_comment(client, post["id"])
    token = _token_for(db_session, comment_id)
    approve = client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert approve.status_code == 200
    assert len(smtp_sink.sent) == 1
    msg = smtp_sink.sent[0]
    assert msg["To"] == "guest@example.com"
    text = _text_part(msg)
    assert "manage" in text
    assert token in text  # the deep link carries the secret the guest owns
    # Flat top-level route (DEC-435/TASK-444): a child under /comments would
    # nest and never mount (Nuxt page-nesting gotcha, per DEC-332).
    assert f"/comment-manage?token={token}" in text


def test_approval_does_not_email_a_non_consenting_guest(client, post, auth_headers, smtp_sink):
    resp = client.post(
        f"/api/comments/post/{post['id']}",
        json={"nickname": "No Mail", "email": "nomail@example.com", "content": "no consent here"},
    )
    assert resp.status_code == 201
    comment_id = resp.json()["id"]
    client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert smtp_sink.sent == []
