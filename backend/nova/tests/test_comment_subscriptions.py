"""Comment-thread subscription contract tests (DEC-078, TASK-150).

A signed-in reader can follow a post's comment thread (``comment_subscriptions``)
and receive a Web Push each time a *new* comment is approved — distinct from
reply notifications (DEC-064), which only target the author of the replied-to
comment. This suite pins the reader-scoped API and the approval fan-out:

- anonymous readers see ``subscribed: false``; only a reader can subscribe;
- subscribe/unsubscribe are idempotent, and private/scheduled/unknown posts
  are uniformly 404 (no draft-existence oracle, same guard as bookmarks);
- the account list shows only publicly-visible followed posts (a followed post
  that turns into a draft stops appearing, and its status read is 404);
- fan-out fires at APPROVAL, targets every follower's push subscriptions,
  deep-links to the new approved comment, excludes the comment's own author
  and (for a reply) the already-notified replied-to reader — who gets exactly
  one push, not two;
- best effort: unconfigured VAPID is a silent no-op; dead (404/410) push
  subscriptions are retired without failing the approval.
"""

from unittest.mock import patch

from app.schemas import PostCreate


def _create_post(db_session, slug="thread-sub-post", published=True):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(title="Thread sub post", slug=slug, content="# Hi", published=published),
    )


def _register(client, email="sub-a@example.com", display_name="A"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": display_name},
    )


def _token(client, **kw):
    return _register(client, **kw).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _subscribe(client, endpoint="https://fcm.example.com/abc", headers=None):
    import base64

    from cryptography.hazmat.primitives.asymmetric import ec

    k = ec.generate_private_key(ec.SECP256R1())
    p = k.public_key().public_numbers()
    raw = b"\x04" + p.x.to_bytes(32, "big") + p.y.to_bytes(32, "big")
    p256dh = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    auth_ = base64.urlsafe_b64encode(b"\x00" * 16).rstrip(b"=").decode()
    return client.post(
        "/api/push/subscribe",
        json={"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth_}},
        headers=headers,
    )


def _follow(client, post_id, token):
    return client.put(f"/api/posts/{post_id}/subscription", headers=_auth(token))


def _status(client, post_id, token=None):
    return client.get(f"/api/posts/{post_id}/subscription", headers=_auth(token) if token else None)


def _comment(client, post_id, token=None, content="new comment", parent_id=None):
    return client.post(
        f"/api/comments/post/{post_id}",
        json={"nickname": "C", "email": "c@example.com", "content": content, "parent_id": parent_id},
        headers=_auth(token) if token else None,
    )


def _approve(client, comment_id, approved=True, auth_headers=None):
    return client.patch(
        f"/api/comments/{comment_id}/approve",
        json={"approved": approved},
        headers=auth_headers or {},
    )


class TestSubscribeToggleStatus:
    def test_anonymous_status_is_false(self, client, db_session):
        post = _create_post(db_session)
        resp = _status(client, post.id)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"post_id": post.id, "subscribed": False}

    def test_status_404_for_private_or_unknown_post(self, client, db_session):
        draft = _create_post(db_session, slug="thread-draft", published=False)
        assert _status(client, draft.id).status_code == 404
        assert _status(client, 999999).status_code == 404

    def test_reader_subscribe_idempotent_single_row(self, client, db_session):
        from app import models

        post = _create_post(db_session)
        token = _token(client)
        r1 = _follow(client, post.id, token)
        r2 = _follow(client, post.id, token)
        # First subscribe is 201; a re-subscribe is 200 (idempotent, matching
        # the bookmark PUT contract — ISS-146).
        assert r1.status_code == 201, r1.text
        assert r2.status_code == 200, r2.text
        assert (
            db_session.query(models.CommentSubscription).filter(models.CommentSubscription.post_id == post.id).count()
            == 1
        )
        assert _status(client, post.id, token).json()["subscribed"] is True

    def test_anonymous_subscribe_and_delete_are_401(self, client, db_session):
        post = _create_post(db_session)
        assert _follow(client, post.id, token=None).status_code in (401, 403)
        assert client.delete(f"/api/posts/{post.id}/subscription").status_code in (401, 403)

    def test_unsubscribe_idempotent_and_flips_status(self, client, db_session):
        post = _create_post(db_session)
        token = _token(client)
        _follow(client, post.id, token)
        assert _status(client, post.id, token).json()["subscribed"] is True
        assert client.delete(f"/api/posts/{post.id}/subscription", headers=_auth(token)).status_code == 204
        assert client.delete(f"/api/posts/{post.id}/subscription", headers=_auth(token)).status_code == 204
        assert _status(client, post.id, token).json()["subscribed"] is False

    def test_account_list_omits_non_public_posts(self, client, db_session):
        from app.schemas import PostUpdate

        post = _create_post(db_session, slug="thread-visible")
        token = _token(client)
        _follow(client, post.id, token)
        listed = client.get("/api/reader/me/post-subscriptions", headers=_auth(token))
        assert listed.status_code == 200, listed.text
        assert listed.json()["total"] == 1
        assert listed.json()["items"][0]["slug"] == "thread-visible"

        # The post becomes a draft -> the read path must not leak it.
        from app import crud

        crud.update_post(db_session, post.id, PostUpdate(published=False))
        relisted = client.get("/api/reader/me/post-subscriptions", headers=_auth(token))
        assert relisted.json()["total"] == 0
        # And the status read now 404s (private), so the anonymous-visible
        # rule matches bookmarks/comments exactly.
        assert _status(client, post.id, token).status_code == 404


class TestThreadFanout:
    _COUNTER = 0

    def _post(self, client, db_session):
        self._COUNTER += 1
        return _create_post(db_session, slug=f"thread-fanout-{self._COUNTER}")

    def test_approving_comment_notifies_subscribers_deep_linked(self, client, db_session, auth_headers):
        post = self._post(client, db_session)
        token_a = _token(client, email=f"fan-a{self._COUNTER}@example.com", display_name="A")
        token_b = _token(client, email=f"fan-b{self._COUNTER}@example.com", display_name="B")
        _subscribe(client, endpoint=f"https://fcm.example.com/a{self._COUNTER}", headers=_auth(token_a))
        _subscribe(client, endpoint=f"https://fcm.example.com/b{self._COUNTER}", headers=_auth(token_b))
        _follow(client, post.id, token_a)
        _follow(client, post.id, token_b)
        created = _comment(client, post.id)  # anonymous author, no self-notify to worry about
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push") as mock_send:
            resp = _approve(client, created.json()["id"], auth_headers=auth_headers)
            assert resp.status_code == 200, resp.text
            assert mock_send.called
            calls = mock_send.call_args_list
            assert len(calls) == 2
            for call in calls:
                payload = call.kwargs["payload"]
                assert payload["url"] == f"/posts/{post.slug}#comment-{created.json()['id']}"
                assert payload["title"]

    def test_pending_comment_sends_nothing(self, client, db_session, auth_headers):
        post = self._post(client, db_session)
        token = _token(client, email=f"fan-a{self._COUNTER}@example.com", display_name="A")
        _subscribe(client, endpoint=f"https://fcm.example.com/a{self._COUNTER}", headers=_auth(token))
        _follow(client, post.id, token)
        with patch("app.webpush.send_push") as mock_send:
            created = _comment(client, post.id)
            assert created.status_code == 201, created.text
            assert not mock_send.called, "a pending comment must not push yet"

    def test_rejecting_comment_sends_nothing(self, client, db_session, auth_headers):
        post = self._post(client, db_session)
        token = _token(client, email=f"fan-a{self._COUNTER}@example.com", display_name="A")
        _subscribe(client, endpoint=f"https://fcm.example.com/a{self._COUNTER}", headers=_auth(token))
        _follow(client, post.id, token)
        created = _comment(client, post.id)
        with patch("app.webpush.send_push") as mock_send:
            resp = _approve(client, created.json()["id"], approved=False, auth_headers=auth_headers)
            assert resp.status_code == 200, resp.text
            assert not mock_send.called

    def test_comment_author_is_not_notified_as_subscriber(self, client, db_session, auth_headers):
        """The comment's own author must not get a thread push about their own
        comment, even if they are subscribed (no self-notification)."""
        post = self._post(client, db_session)
        token_a = _token(client, email=f"fan-a{self._COUNTER}@example.com", display_name="A")
        _subscribe(client, endpoint=f"https://fcm.example.com/a{self._COUNTER}", headers=_auth(token_a))
        _follow(client, post.id, token_a)
        created = _comment(client, post.id, token=token_a)
        assert created.status_code == 201, created.text
        with patch("app.webpush.send_push") as mock_send:
            _approve(client, created.json()["id"], auth_headers=auth_headers)
            assert not mock_send.called

    def test_reply_dispatches_single_push_per_parent_reader(self, client, db_session, auth_headers):
        """A replied-to reader who ALSO follows the thread gets exactly one push
        (the targeted reply notification), not a second thread-follow push."""
        from app.crud import approve_comment

        post = self._post(client, db_session)
        token_a = _token(client, email=f"fan-a{self._COUNTER}@example.com", display_name="A")
        token_b = _token(client, email=f"fan-b{self._COUNTER}@example.com", display_name="B")
        token_c = _token(client, email=f"fan-c{self._COUNTER}@example.com", display_name="C")
        a_endpoint = f"https://fcm.example.com/a{self._COUNTER}"
        c_endpoint = f"https://fcm.example.com/c{self._COUNTER}"
        _subscribe(client, endpoint=a_endpoint, headers=_auth(token_a))
        _subscribe(client, endpoint=c_endpoint, headers=_auth(token_c))
        # A (parent) and C both follow the thread.
        _follow(client, post.id, token_a)
        _follow(client, post.id, token_c)
        parent = _comment(client, post.id, token=token_a, content="parent")
        assert parent.status_code == 201
        approve_comment(db_session, parent.json()["id"], approved=True)
        # B replies to A's comment; B does not follow the thread.
        reply = _comment(client, post.id, token=token_b, content="reply", parent_id=parent.json()["id"])
        assert reply.status_code == 201, reply.text
        with patch("app.webpush.send_push") as mock_send:
            _approve(client, reply.json()["id"], auth_headers=auth_headers)
            assert mock_send.called
            by_endpoint = {call.kwargs["endpoint"] for call in mock_send.call_args_list}
            # A: exactly one push (the reply notification, deep-linked to their
            # comment) — no duplicate thread push. C: one thread push.
            assert by_endpoint == {a_endpoint, c_endpoint}
            for call in mock_send.call_args_list:
                if call.kwargs["endpoint"] == a_endpoint:
                    assert call.kwargs["payload"]["url"] == f"/posts/{post.slug}#comment-{parent.json()['id']}"
                else:
                    assert call.kwargs["payload"]["url"] == f"/posts/{post.slug}#comment-{reply.json()['id']}"

    def test_unconfigured_vapid_is_silent_noop(self, client, db_session, auth_headers):
        post = self._post(client, db_session)
        token = _token(client, email=f"fan-a{self._COUNTER}@example.com", display_name="A")
        _subscribe(client, endpoint=f"https://fcm.example.com/a{self._COUNTER}", headers=_auth(token))
        _follow(client, post.id, token)
        created = _comment(client, post.id)
        # _notify_thread_subscribers calls the by-name import in comments.py, so
        # patch that binding (patching app.webpush.vapid_configured alone would
        # leave comments.vapid_configured — a separate reference — unpatched).
        with (
            patch("app.routers.comments.vapid_configured", return_value=False),
            patch("app.webpush.send_push") as mock_send,
        ):
            resp = _approve(client, created.json()["id"], auth_headers=auth_headers)
            assert resp.status_code == 200, resp.text
            assert not mock_send.called

    def test_thread_dispatch_retires_dead_subscription(self, client, db_session, auth_headers):
        from pywebpush import WebPushException

        post = self._post(client, db_session)
        token = _token(client, email=f"fan-a{self._COUNTER}@example.com", display_name="A")
        endpoint = f"https://fcm.example.com/a{self._COUNTER}"
        _subscribe(client, endpoint=endpoint, headers=_auth(token))
        _follow(client, post.id, token)
        created = _comment(client, post.id)

        class DeadPush(WebPushException):
            def __init__(self):
                super().__init__("gone")
                self.response = type("R", (), {"status_code": 410})()

        with patch("app.webpush.send_push", side_effect=DeadPush) as mock_send:
            resp = _approve(client, created.json()["id"], auth_headers=auth_headers)
            assert resp.status_code == 200, resp.text
            assert mock_send.called
        from app import models

        remaining = db_session.query(models.PushSubscription).filter(models.PushSubscription.endpoint == endpoint).all()
        assert remaining == []
