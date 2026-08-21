"""Reader comment-reply notifications contract tests (DEC-064, TASK-137).

A reader who comments on a post can receive a Web Push notification when
someone replies to *their* comment. The push subscription is bound to the
reader account (reader_id) at subscribe time; when a reply is APPROVED (every
comment is moderated), the parent author's subscriptions (if any, and if not
the replier) each receive a notification. Notifying at approval — not at
create — means a reader only hears about replies they can actually see.

Key properties:
- subscribe with a reader token stamps reader_id; without one stays anonymous;
- a pending reply sends nothing; approving it pushes that reader's subscriptions;
- rejecting a reply sends nothing;
- replying to your own comment does NOT notify yourself;
- replying to an anonymous comment's author does nothing (no target identity);
- unconfigured VAPID: subscribe fails closed (503) — notification dispatch
  silently skips (no push infra), never breaks the comment create path;
- notifications reuse send_push and retire dead (404/410) subscriptions.
"""

from unittest.mock import patch

from app.schemas import PostCreate


def _create_post(db_session, slug="reply-notif-post"):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(title="Reply notif post", slug=slug, content="# Hi", published=True),
    )


def _register(client, email="replier@example.com", display_name="Replier"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": display_name},
    )


def _token(client, **kw):
    return _register(client, **kw).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _subscribe(client, endpoint="https://fcm.example.com/abc", p256dh=None, auth_=None, headers=None):
    body = {
        "endpoint": endpoint,
        "keys": {
            "p256dh": p256dh or ("A" * 43 + "="),  # 32 raw bytes, base64url-ish minimal
            "auth": auth_ or ("B" * 22 + "="),  # 16 raw bytes
        },
    }
    return client.post("/api/push/subscribe", json=body, headers=headers)


# Valid-ish base64url blobs of the required lengths are cumbersome to craft
# inline; use real ones from the keypairs the test env generates.
def _valid_p256dh():
    # 65-byte uncompressed EC point -> 88 base64url chars
    from cryptography.hazmat.primitives.asymmetric import ec

    k = ec.generate_private_key(ec.SECP256R1())
    p = k.public_key().public_numbers()
    import base64

    raw = b"\x04" + p.x.to_bytes(32, "big") + p.y.to_bytes(32, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _valid_auth():
    import base64

    return base64.urlsafe_b64encode(b"\x00" * 16).rstrip(b"=").decode()


class TestSubscribeBindsReader:
    def test_anonymous_subscribe_has_no_reader(self, client, db_session):
        from app import models

        resp = _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth())
        assert resp.status_code == 200, resp.text
        sub = (
            db_session.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == "https://fcm.example.com/abc")
            .first()
        )
        assert sub is not None
        assert sub.reader_id is None

    def test_reader_subscribe_stamps_reader_id(self, client, db_session):
        from app import models

        token = _token(client)
        resp = _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(token))
        assert resp.status_code == 200, resp.text
        sub = (
            db_session.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == "https://fcm.example.com/abc")
            .first()
        )
        assert sub is not None
        assert sub.reader_id is not None

    def test_reader_resubscribe_refreshes_reader_id(self, client, db_session):
        from app import models

        t1 = _token(client, email="a@example.com", display_name="A")
        t2 = _token(client, email="b@example.com", display_name="B")
        _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(t1))
        _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(t2))
        sub = (
            db_session.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == "https://fcm.example.com/abc")
            .first()
        )
        assert sub.reader_id is not None
        # endpoint re-subscribed by B -> reader_id now B's
        from app.auth import ReaderAccount

        reader_b = db_session.query(ReaderAccount).filter(ReaderAccount.email == "b@example.com").first()
        assert sub.reader_id == reader_b.id


class TestReplyNotification:
    _COUNTER = 0

    def _parent(self, client, db_session, email=None):
        """Approved root comment by a reader. Returns (post, parent_id, token)."""
        from app.crud import approve_comment

        self._COUNTER += 1
        email = email or f"reply-a{self._COUNTER}@example.com"
        post = _create_post(db_session, slug=f"reply-notif-{self._COUNTER}")
        token = _token(client, email=email, display_name="A")
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "A", "email": email, "content": "original"},
            headers=_auth(token),
        )
        assert created.status_code == 201, created.text
        # Approve the parent so replies are allowed (approving a root comment
        # is not itself a reply-notification event).
        approve_comment(db_session, created.json()["id"], approved=True)
        return post, created.json()["id"], token

    def _reply(self, client, post_id, parent_id, token, content="reply"):
        self._COUNTER += 1
        return client.post(
            f"/api/comments/post/{post_id}",
            json={
                "nickname": f"B{self._COUNTER}",
                "email": f"reply-b{self._COUNTER}@example.com",
                "content": content,
                "parent_id": parent_id,
            },
            headers=_auth(token),
        )

    def _approve(self, client, comment_id, approved=True, auth_headers=None):
        return client.patch(
            f"/api/comments/{comment_id}/approve",
            json={"approved": approved},
            headers=auth_headers or {},
        )

    def test_pending_reply_sends_nothing_until_approval(self, client, db_session, auth_headers):
        """The reply notification fires at approval, not at create: a pending
        (invisible to the reader) reply must not notify their phone first."""
        post, parent_id, token_a = self._parent(client, db_session)
        _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(token_a))
        token_b = _token(client, email=f"reply-bzz{self._COUNTER}@example.com", display_name="B")
        with patch("app.webpush.send_push") as mock_send:
            created = self._reply(client, post.id, parent_id, token_b)
            assert created.status_code == 201, created.text
            assert not mock_send.called, "a pending reply must not push yet"
        # Admin approves -> A is notified.
        with patch("app.webpush.send_push") as mock_send:
            resp = self._approve(client, created.json()["id"], auth_headers=auth_headers)
            assert resp.status_code == 200, resp.text
            assert mock_send.called, "approving a reply to a subscribed reader should push"
            args = mock_send.call_args.kwargs
            assert args["payload"]["url"].startswith("/posts/")
            assert args["payload"]["title"]

    def test_reply_push_url_deep_links_to_parent_comment(self, client, db_session, auth_headers):
        """The notification's click URL must land ON the replied-to comment, not
        the top of a possibly long post (DEC-072, TASK-145)."""
        post, parent_id, token_a = self._parent(client, db_session)
        _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(token_a))
        token_b = _token(client, email=f"reply-bzz{self._COUNTER}@example.com", display_name="B")
        created = self._reply(client, post.id, parent_id, token_b)
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push") as mock_send:
            self._approve(client, created.json()["id"], auth_headers=auth_headers)
            assert mock_send.called
            url = mock_send.call_args.kwargs["payload"]["url"]
            assert url == f"/posts/{post.slug}#comment-{parent_id}"

    def test_rejecting_reply_sends_no_push(self, client, db_session, auth_headers):
        post, parent_id, token_a = self._parent(client, db_session)
        _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(token_a))
        token_b = _token(client, email=f"reply-bzz{self._COUNTER}@example.com", display_name="B")
        created = self._reply(client, post.id, parent_id, token_b)
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push") as mock_send:
            resp = self._approve(client, created.json()["id"], approved=False, auth_headers=auth_headers)
            assert resp.status_code == 200, resp.text
            assert not mock_send.called

    def test_approving_self_reply_does_not_self_notify(self, client, db_session, auth_headers):
        post, parent_id, token_a = self._parent(client, db_session)
        _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(token_a))
        # A replies to A's own comment; approving it must NOT notify A.
        created = self._reply(client, post.id, parent_id, token_a, content="self reply")
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push") as mock_send:
            self._approve(client, created.json()["id"], auth_headers=auth_headers)
            assert not mock_send.called

    def test_approving_reply_to_unsubscribed_reader_no_push(self, client, db_session, auth_headers):
        post, parent_id, _token_a = self._parent(client, db_session)
        # A never subscribed
        token_b = _token(client, email=f"reply-bzz{self._COUNTER}@example.com", display_name="B")
        created = self._reply(client, post.id, parent_id, token_b)
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push") as mock_send:
            self._approve(client, created.json()["id"], auth_headers=auth_headers)
            assert not mock_send.called

    def test_approving_reply_to_anonymous_comment_no_push(self, client, db_session, auth_headers):
        from app.crud import approve_comment

        post = _create_post(db_session, slug=f"reply-notif-anon-{self._COUNTER}")
        anon = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "Guest", "email": "g@example.com", "content": "anon"},
        )
        assert anon.status_code == 201
        parent_id = anon.json()["id"]
        approve_comment(db_session, parent_id, approved=True)  # reply must be allowed
        token_b = _token(client, email=f"reply-bzz{self._COUNTER}@example.com", display_name="B")
        created = self._reply(client, post.id, parent_id, token_b)
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push") as mock_send:
            self._approve(client, created.json()["id"], auth_headers=auth_headers)
            assert not mock_send.called

    def test_approval_dispatch_retires_dead_subscription(self, client, db_session, auth_headers):
        from pywebpush import WebPushException

        post, parent_id, token_a = self._parent(client, db_session)
        _subscribe(client, p256dh=_valid_p256dh(), auth_=_valid_auth(), headers=_auth(token_a))

        class DeadPush(WebPushException):
            def __init__(self):
                super().__init__("gone")
                # WebPushException.__init__ sets self.response=None; the
                # dispatch reads the instance attribute, so set it directly.
                self.response = type("R", (), {"status_code": 410})()

        token_b = _token(client, email=f"reply-bzz{self._COUNTER}@example.com", display_name="B")
        created = self._reply(client, post.id, parent_id, token_b)
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push", side_effect=DeadPush) as mock_send:
            self._approve(client, created.json()["id"], auth_headers=auth_headers)
            assert mock_send.called
        # The dead subscription was retired.
        from app import models

        remaining = (
            db_session.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == "https://fcm.example.com/abc")
            .all()
        )
        assert remaining == []
