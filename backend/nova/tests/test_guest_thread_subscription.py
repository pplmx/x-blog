"""Guest email thread-follow contract + fan-out tests (DEC-427, TASK-438).

Comment-thread follow (DEC-078) was reader-gated — ``PUT /posts/{id}/subscription``
requires a reader account and the post-page control redirects guests to /login
— yet the blog already emails anonymous addresses for the newsletter (DEC-351)
and reply notices (DEC-332). This feature gives an anonymous visitor the same
ability for a discussion: subscribe a post's thread by email (double opt-in,
mirroring ``NewsletterSubscriber``), get one email per new APPROVED comment
with a one-click unsubscribe, and never need an account.

Key properties:
- POST /api/posts/{id}/comment-subscription/guest {email} is auth-free, 202,
  and returns a generic message (no address-existence oracle); a NEW row sends
  exactly ONE double-opt-in confirmation email, a resubscribe sends none;
- confirm/unsubscribe ({token}) are auth-free, idempotent 200 on the happy/
  stale path and a uniform 404 for an unknown token (no token oracle);
- fan-out: on comment approval, every CONFIRMED guest subscriber of the post
  gets a per-comment email (deep link + one-click unsubscribe), pending and
  unsubscribed rows get nothing, and the commenter's own guest address is
  skipped; best effort (SMTP unconfigured never breaks the approval).
"""

from uuid import uuid4

from app.schemas import PostCreate

BASE = "/api/posts/{post_id}/comment-subscription/guest"


def _create_post(db_session, slug=None):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(
            title=f"Thread {uuid4().hex[:4]}",
            slug=slug or f"guest-thread-{uuid4().hex[:8]}",
            content="# Hi",
            published=True,
        ),
    )


def _subscribe(client, post_id, email):
    return client.post(BASE.format(post_id=post_id), json={"email": email})


def _confirm(client, token):
    return client.post("/api/posts/comment-subscription/guest/confirm", json={"token": token})


def _unsubscribe(client, token):
    return client.post("/api/posts/comment-subscription/guest/unsubscribe", json={"token": token})


def _comment(client, post_id, content, token=None, nickname="Guest", email=None):
    body = {"content": content, "nickname": nickname, "email": email or "guest@example.com"}
    client_headers = {"Authorization": f"Bearer {token}"} if token else {}
    return client.post(f"/api/comments/post/{post_id}", json=body, headers=client_headers)


def _approve(client, auth_headers, comment_id):
    resp = client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


class FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording every delivered message."""

    sent: list = []
    instances: list = []

    def __init__(self, *args, **kwargs):
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return None

    def starttls(self, context=None):
        return None

    def login(self, user, password):
        return None

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)

    def quit(self):
        return None


def _sink(monkeypatch) -> type[FakeSMTP]:
    """Configure SMTP against the fake sink and reset its capture per test."""
    FakeSMTP.instances = []
    FakeSMTP.sent = []
    monkeypatch.setattr("app.emailer.smtplib.SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
    monkeypatch.setenv("SMTP_PORT", "2525")
    return FakeSMTP


def _to(sink: type[FakeSMTP], address: str) -> list:
    return [m for m in sink.sent if m["To"] == address]


def _plain(msg) -> str:
    parts = [p for p in msg.walk() if p.get_content_type() == "text/plain"]
    return "\n".join(p.get_payload(decode=True).decode("utf-8", "replace") for p in parts)


def _fanout_to(sink: type[FakeSMTP], address: str) -> list:
    """Thread fan-out emails to ``address``, excluding the double-opt-in confirm."""
    return [m for m in _to(sink, address) if "/comment-subscribe/confirm" not in _plain(m)]


class TestSubscribeContract:
    def test_missing_or_invalid_email_is_422(self, client, db_session):
        post = _create_post(db_session)
        for payload in ({}, {"email": ""}, {"email": "nope"}):
            r = client.post(BASE.format(post_id=post.id), json=payload)
            assert r.status_code == 422, payload

    def test_auth_free_and_generic(self, client, db_session):
        post = _create_post(db_session)
        r = _subscribe(client, post.id, "guest@example.com")
        assert r.status_code == 202
        assert r.json()["subscribed"] is True

    def test_confirmation_email_sent_on_new_row_only(self, client, db_session, monkeypatch):
        post = _create_post(db_session)
        sink = _sink(monkeypatch)
        assert _subscribe(client, post.id, "dup@example.com").status_code == 202
        assert _subscribe(client, post.id, "dup@example.com").status_code == 202
        # Exactly ONE confirmation email for the address, whatever the outcome.
        assert len(_to(sink, "dup@example.com")) == 1
        body = _plain(_to(sink, "dup@example.com")[0])
        assert "/comment-subscribe/confirm" in body

    def test_email_normalized_lowercase(self, client, db_session):
        from app import models

        post = _create_post(db_session)
        _subscribe(client, post.id, "   MiXeD@Example.COM ")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "mixed@example.com")
            .one()
        )
        assert row.post_id == post.id
        assert row.is_confirmed is False

    def test_unknown_post_is_uniform_404(self, client):
        assert _subscribe(client, 999999, "nobody@example.com").status_code == 404


class TestConfirmAndUnsubscribe:
    def test_confirm_flips_confirmed_and_is_idempotent(self, client, db_session, monkeypatch):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "cf@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "cf@example.com")
            .one()
        )
        assert _confirm(client, row.token).status_code == 200
        db_session.refresh(row)
        assert row.is_confirmed is True
        # Second click is a 200, still confirmed.
        assert _confirm(client, row.token).status_code == 200

    def test_unsubscribe_flips_off_and_is_idempotent(self, client, db_session, monkeypatch):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "un@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "un@example.com")
            .one()
        )
        _confirm(client, row.token)
        assert _unsubscribe(client, row.token).status_code == 200
        db_session.refresh(row)
        assert row.is_confirmed is False
        assert _unsubscribe(client, row.token).status_code == 200

    def test_unknown_token_is_404(self, client):
        assert _confirm(client, "bogus").status_code == 404
        assert _unsubscribe(client, "bogus").status_code == 404


class TestThreadFanOut:
    def _setup(self, client, db_session, monkeypatch, guest_email, post=None):
        from app import models

        post = post or _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, guest_email)
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == guest_email)
            .one()
        )
        _confirm(client, row.token)
        return post, row

    def test_confirmed_guest_gets_email_per_approved_comment(self, client, db_session, monkeypatch, auth_headers):
        post, _ = self._setup(client, db_session, monkeypatch, "fan@example.com")
        sink = FakeSMTP
        created = _comment(client, post.id, "a new thread comment", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])
        msgs = _fanout_to(sink, "fan@example.com")
        assert len(msgs) == 1
        body = _plain(msgs[0])
        assert f"/posts/{post.slug}#comment-" in body  # deep link
        assert "/comment-subscribe/unsubscribe" in body  # one-click unsubscribe

    def test_pending_subscriber_gets_nothing(self, client, db_session, monkeypatch, auth_headers):
        post = _create_post(db_session)
        _sink(monkeypatch)
        _subscribe(client, post.id, "pending@example.com")  # never confirmed
        created = _comment(client, post.id, "chatter", email="x@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert _fanout_to(FakeSMTP, "pending@example.com") == []

    def test_unsubscribed_rows_stay_silent(self, client, db_session, monkeypatch, auth_headers):
        from app import models

        post, _ = self._setup(client, db_session, monkeypatch, "gone@example.com")
        row = (
            db_session.query(models.GuestCommentSubscription)
            .filter(models.GuestCommentSubscription.email == "gone@example.com")
            .one()
        )
        _unsubscribe(client, row.token)
        created = _comment(client, post.id, "after unsub", email="x@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert _fanout_to(FakeSMTP, "gone@example.com") == []

    def test_commenters_own_guest_email_is_skipped(self, client, db_session, monkeypatch, auth_headers):
        post, _ = self._setup(client, db_session, monkeypatch, "mine@example.com")
        # The same guest who follows the thread comments on it afterward.
        created = _comment(client, post.id, "also following", email="mine@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert _fanout_to(FakeSMTP, "mine@example.com") == []

    def test_all_confirmed_subscribers_are_emailed(self, client, db_session, monkeypatch, auth_headers):
        from app import models

        post = _create_post(db_session)
        _sink(monkeypatch)
        for email in ("one@example.com", "two@example.com"):
            _subscribe(client, post.id, email)
            row = (
                db_session.query(models.GuestCommentSubscription)
                .filter(models.GuestCommentSubscription.email == email)
                .one()
            )
            _confirm(client, row.token)
        created = _comment(client, post.id, "broadcast", email="other@example.com")
        _approve(client, auth_headers, created.json()["id"])
        assert len(_fanout_to(FakeSMTP, "one@example.com")) == 1
        assert len(_fanout_to(FakeSMTP, "two@example.com")) == 1

    def test_reader_comment_also_fans_out(self, client, db_session, monkeypatch, auth_headers):
        from uuid import uuid4 as _u4

        post, _ = self._setup(client, db_session, monkeypatch, "rfan@example.com")
        token = client.post(
            "/api/reader/register",
            json={"email": f"reader{_u4().hex[:4]}@example.com", "password": "readerpass123"},
        ).json()["access_token"]
        created = _comment(client, post.id, "reader take", token=token, nickname="R")
        _approve(client, auth_headers, created.json()["id"])
        assert len(_fanout_to(FakeSMTP, "rfan@example.com")) == 1

    def test_smtp_unconfigured_never_breaks_approval(self, client, db_session, monkeypatch, auth_headers):
        post, _ = self._setup(client, db_session, monkeypatch, "off@example.com")
        monkeypatch.delenv("SMTP_HOST", raising=False)
        monkeypatch.delenv("SMTP_PORT", raising=False)
        created = _comment(client, post.id, "no email infra", email="x@example.com")
        resp = client.patch(
            f"/api/comments/{created.json()['id']}/approve",
            json={"approved": True},
            headers=auth_headers,
        )
        assert resp.status_code == 200
