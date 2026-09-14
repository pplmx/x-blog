"""Guest commenter reply-email contract tests (DEC-332, TASK-392).

The comment form REQUIRES a guest to leave an email and `create_comment`
persists it on the comment row, but until DEC-332 no dispatch path ever used
it: the reply-notify guard was `parent.reader_id is not None`, so a reply to an
anonymous comment notified nobody — the one contact channel the system
collects from guests was dead in every channel.

The feature: a guest who explicitly opts in (comment-form checkbox,
`reply_notify_email=True`) receives ONE email when a reply to their comment is
approved, deep-linking to the reply and carrying a working per-comment
unsubscribe link; a guest who never opted in (or later unsubscribed) is never
emailed, and approving still succeeds when SMTP is unconfigured (best effort,
mirroring every other notification path).

Key properties:
- an anonymous comment with reply_notify_email=true stores the consent and a
  per-comment unsubscribe token; approving a reply emails the GUEST's own
  address (the reply deep-link + the unsubscribe link);
- a guest who did not opt in is never emailed;
- a reply to a READER-attributed parent still uses the reader fan-out only
  (no stray guest email; DEC-062');
- reply_notify_email is never honored for signed-in readers (their reply email
  is the account-level DEC-197 pref, not a comment-row field);
- POST /api/comments/reply-notify/unsubscribe flips consent off idempotently;
  an unknown token is 404; after unsubscribing, later approvals send nothing;
- SMTP unconfigured: approve still succeeds, no email is attempted (fails
  closed, best effort).
"""

from email.message import EmailMessage

import pytest

from app import models
from app.schemas import PostCreate


def _create_post(db_session, slug="guest-reply-post"):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(title="Guest reply post", slug=slug, content="# Hi", published=True),
    )


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
    monkeypatch.setenv("SMTP_FROM", "blog@example.com")
    monkeypatch.setenv("SITE_URL", "https://blog.example.com")
    return FakeSMTP


def _guest_comment(client, post_id, *, email="guest@example.com", nickname="Guest", content="hello"):
    resp = client.post(
        f"/api/comments/post/{post_id}",
        json={
            "nickname": nickname,
            "email": email,
            "content": content,
            "reply_notify_email": True,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _approve_parent(client, parent_id, auth_headers):
    """Approve a root comment so replies to it are allowed (replies to pending
    comments are refused by create_comment — an approved reply cannot orphan
    under a parent a moderator later rejects)."""
    resp = _approve(client, parent_id, auth_headers)
    assert resp.status_code == 200, resp.text


def _reply(client, post_id, parent_id, *, content="a reply", **kw):
    resp = client.post(
        f"/api/comments/post/{post_id}",
        json={
            "nickname": "Replier",
            "email": "replier@example.com",
            "content": content,
            "parent_id": parent_id,
            **kw,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _approve(client, comment_id, auth_headers):
    return client.patch(
        f"/api/comments/{comment_id}/approve",
        json={"approved": True},
        headers=auth_headers,
    )


def _text_part(msg: EmailMessage) -> str:
    """The plain-text body of a multipart/alternative email (or the whole body
    for a single-part message) — the fake sink records EmailMessage objects,
    and get_content() raises on multipart."""
    if msg.is_multipart():
        for part in msg.iter_parts():
            if part.get_content_type() == "text/plain":
                return part.get_content()
    return msg.get_content()


def _guest_email_record(email="guest@example.com"):
    """The latest SMTP-sink record addressed to ``email`` (or None)."""
    latest = None
    for msg in FakeSMTP.sent:
        if msg["To"] != email:
            continue
        latest = {
            "to": msg["To"],
            "subject": msg["Subject"],
            "text": _text_part(msg),
        }
    return latest


class TestGuestReplyEmail:
    def test_approved_reply_emails_opted_in_guest(self, client, db_session, auth_headers, smtp_sink):
        post = _create_post(db_session)
        guest = _guest_comment(client, post.id)
        _approve_parent(client, guest["id"], auth_headers)
        reply = _reply(client, post.id, guest["id"])

        resp = _approve(client, reply["id"], auth_headers)
        assert resp.status_code == 200, resp.text

        # The row persisted the consent + a per-comment unsubscribe token.
        row = db_session.get(models.Comment, guest["id"])
        assert row.reply_notify_email is True
        assert row.reply_notify_token

        record = _guest_email_record("guest@example.com")
        assert record is not None, "the opted-in guest should have received the reply email"
        assert record["subject"] == "有人回复了你的评论"
        # Deep link to the reply itself, not the whole thread.
        assert f"/posts/guest-reply-post#comment-{reply['id']}" in record["text"]
        # The unsubscribe link carries the per-comment token. The flat
        # /comment-reply-unsubscribe route is deliberate: a child under the
        # /comments page would nest and never mount (Nuxt page-nesting
        # gotcha, DEC-332).
        assert f"/comment-reply-unsubscribe?token={row.reply_notify_token}" in record["text"]

    def test_guest_who_did_not_opt_in_never_emailed(self, client, db_session, auth_headers, smtp_sink):
        post = _create_post(db_session)
        guest = client.post(
            f"/api/comments/post/{post.id}",
            json={
                "nickname": "Guest",
                "email": "quiet@example.com",
                "content": "no consent",
                "reply_notify_email": False,
            },
        ).json()
        _approve_parent(client, guest["id"], auth_headers)
        reply = _reply(client, post.id, guest["id"])
        assert _approve(client, reply["id"], auth_headers).status_code == 200
        assert _guest_email_record("quiet@example.com") is None
        # And the consent was stored false on the row.
        row = db_session.get(models.Comment, guest["id"])
        assert row.reply_notify_email is False
        assert row.reply_notify_token is None

    def test_guest_without_email_never_emailed(self, client, db_session, auth_headers, smtp_sink):
        post = _create_post(db_session)
        guest = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "Anon", "email": "", "content": "no address", "reply_notify_email": True},
        ).json()
        _approve_parent(client, guest["id"], auth_headers)
        reply = _reply(client, post.id, guest["id"])
        assert _approve(client, reply["id"], auth_headers).status_code == 200
        assert FakeSMTP.sent == []
        row = db_session.get(models.Comment, guest["id"])
        # Consent with no address to deliver to is not stored (no token either).
        assert row.reply_notify_email is False
        assert row.reply_notify_token is None

    def test_reader_parent_uses_reader_fanout_only(self, client, db_session, auth_headers, smtp_sink):
        """A reply to a READER's comment must not double-fire a guest email
        (the reader's address comes from the account, not the comment row)."""
        post = _create_post(db_session)
        # A signed-in reader comments; reply_notify_email is ignored (their
        # reply email is the DEC-197 account pref, never a comment-row field).
        reg = client.post(
            "/api/reader/register",
            json={"email": "reader-owner@example.com", "password": "readerpass123", "display_name": "Owner"},
        )
        token = reg.json()["access_token"]
        reader_comment = client.post(
            f"/api/comments/post/{post.id}",
            json={
                "nickname": "Owner",
                "email": "placeholder@example.com",
                "content": "reader comment",
                "reply_notify_email": True,
            },
            headers={"Authorization": f"Bearer {token}"},
        ).json()
        _approve_parent(client, reader_comment["id"], auth_headers)
        reply = _reply(client, post.id, reader_comment["id"])
        assert _approve(client, reply["id"], auth_headers).status_code == 200
        # No email to the (nonexistent) comment-row address — the reader row
        # stores no free-text email (DEC-062).
        assert FakeSMTP.sent == []

    def test_unsubscribe_flips_consent_and_stops_later_mail(self, client, db_session, auth_headers, smtp_sink):
        post = _create_post(db_session)
        guest = _guest_comment(client, post.id)
        _approve_parent(client, guest["id"], auth_headers)
        row = db_session.get(models.Comment, guest["id"])
        token = row.reply_notify_token

        # Unsubscribe (idempotent).
        resp = client.post("/api/comments/reply-notify/unsubscribe", json={"token": str(token)})
        assert resp.status_code == 200, resp.text
        resp2 = client.post("/api/comments/reply-notify/unsubscribe", json={"token": str(token)})
        assert resp2.status_code == 200, "unsubscribe must be idempotent"

        fresh_row = db_session.get(models.Comment, guest["id"])
        assert fresh_row.reply_notify_email is False

        # A reply approved AFTER unsubscribe sends nothing.
        reply = _reply(client, post.id, guest["id"])
        assert _approve(client, reply["id"], auth_headers).status_code == 200
        assert _guest_email_record("guest@example.com") is None

    def test_unknown_unsubscribe_token_404(self, client):
        resp = client.post("/api/comments/reply-notify/unsubscribe", json={"token": "nope"})
        assert resp.status_code == 404, resp.text

    def test_smtp_unconfigured_approve_still_succeeds(self, client, db_session, auth_headers):
        """Fails closed: no SMTP host -> approve still works, nothing emailed."""
        post = _create_post(db_session)
        guest = _guest_comment(client, post.id)
        _approve_parent(client, guest["id"], auth_headers)
        reply = _reply(client, post.id, guest["id"])
        resp = _approve(client, reply["id"], auth_headers)
        assert resp.status_code == 200, resp.text

    def test_comment_public_list_omits_token_and_consent(self, client, db_session, auth_headers, smtp_sink):
        """The token and consent flag are private row data: the public thread
        list must not expose them (PII-adjacent machinery, DEC-062 bar)."""
        post = _create_post(db_session)
        guest = _guest_comment(client, post.id)
        _approve(client, guest["id"], auth_headers)
        listing = client.get(f"/api/comments/post/{post.id}").json()
        item = next(i for i in listing["items"] if i["id"] == guest["id"])
        assert "reply_notify_token" not in item
        assert "reply_notify_email" not in item
