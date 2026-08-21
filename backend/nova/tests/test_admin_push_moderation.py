"""Admin comment-moderation push contract tests (DEC-080, TASK-152).

The blog moderates every comment (no auto-approve, DEC-066); an admin
(superuser or editor, DEC-054) can opt a browser into a push when a new
comment is created (pending). Key properties:

- POST /api/admin/push/subscribe requires an admin token (401 anonymous,
  401 reader-scoped, 403 non-admin role); a valid admin registers the browser
  bound to their user_id — upsert by endpoint, re-binding on re-subscribe.
- POST /api/admin/push/unsubscribe removes only the caller's own endpoint
  (idempotent; another admin's subscription survives).
- Creating a comment on a publicly-visible post pushes opted-in admin
  subscriptions at CREATE time (the whole point is "something needs your
  approval"), payload deep-links to /admin/comments; the comment stays pending.
- Unconfigured VAPID or no subscriptions: best-effort silent no-op — the
  comment create never fails because of notifications.
- Dispatch targets AdminPushSubscription rows for ADMIN-role accounts only
  (a row bound to a non-admin is skipped); reader PushSubscription rows are
  never touched by the moderation fan-out.
- Dead (404/410) admin endpoints are retired on dispatch.
"""

import base64
from unittest.mock import patch

from app import models
from app.auth import ROLE_SUPERUSER, User, create_access_token, get_password_hash
from app.schemas import PostCreate

SUPER_ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/admin-aaaaaaaaaa"
EDITOR_ENDPOINT = "https://fcm.googleapis.com/fcm/send/admin-bbbbbbbbbbbb"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _valid_p256dh() -> str:
    """A real 65-byte uncompressed EC point (same shape as VAPID publish keys)."""
    from cryptography.hazmat.primitives.asymmetric import ec

    k = ec.generate_private_key(ec.SECP256R1())
    p = k.public_key().public_numbers()
    return _b64url(b"\x04" + p.x.to_bytes(32, "big") + p.y.to_bytes(32, "big"))


def _valid_auth() -> str:
    return _b64url(b"\x00" * 16)


def _body(endpoint: str, p256dh=None, auth_=None) -> dict:
    return {
        "endpoint": endpoint,
        "keys": {"p256dh": p256dh or _valid_p256dh(), "auth": auth_ or _valid_auth()},
    }


def _create_post(db_session, slug="moderation-push-post"):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(title="Moderation push post", slug=slug, content="# Hi", published=True),
    )


def _comment(client, post: models.Post, content="new pending comment"):
    return client.post(
        f"/api/comments/post/{post.id}", json={"nickname": "Guest", "email": "g@x.com", "content": content}
    )


class TestAdminSubscribeAuth:
    def test_anonymous_rejected(self, client):
        response = client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT))
        assert response.status_code == 401

    def test_reader_token_rejected(self, client):
        # Audience separation (DEC-059): a reader-scoped token must never
        # authenticate against an admin endpoint.
        from app.auth import create_reader_token

        reader_token = create_reader_token({"sub": 1})
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(SUPER_ENDPOINT),
            headers={"Authorization": f"Bearer {reader_token}"},
        )
        assert response.status_code == 401

    def test_non_admin_role_rejected(self, client, db_session):
        # A User whose role is not an admin tier gets 403 on every admin guard.
        user = User(
            username="vieweronly",
            password=get_password_hash("pass12345"),
            role="viewer",
            is_superuser=False,
        )
        db_session.add(user)
        db_session.flush()
        token = create_access_token({"sub": user.id}, token_version=user.token_version or 0)
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(SUPER_ENDPOINT),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 403

    def test_editor_can_subscribe(self, client, editor_headers):
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(EDITOR_ENDPOINT),
            headers=editor_headers,
        )
        assert response.status_code == 200

    def test_superuser_can_subscribe(self, client, auth_headers):
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(SUPER_ENDPOINT),
            headers=auth_headers,
        )
        assert response.status_code == 200


class TestAdminSubscribeValidation:
    def test_rejects_overlong_endpoint(self, client, auth_headers):
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body("https://example.com/" + "x" * 500),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_rejects_unsafe_endpoint_scheme(self, client, auth_headers):
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body("javascript:alert(1)"),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_rejects_invalid_p256dh(self, client, auth_headers):
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(SUPER_ENDPOINT, p256dh=_b64url(b"\x00" * 8)),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_rejects_invalid_auth_len(self, client, auth_headers):
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(SUPER_ENDPOINT, auth_=_b64url(b"\x00" * 4)),
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_fails_closed_when_vapid_unconfigured(self, client, auth_headers, monkeypatch):
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(SUPER_ENDPOINT),
            headers=auth_headers,
        )
        assert response.status_code == 503


class TestAdminSubscribeStore:
    def test_subscribe_stores_row_bound_to_user(self, client, db_session, auth_headers, admin_user):
        assert admin_user.role == ROLE_SUPERUSER
        # _valid_p256dh() yields a fresh key each call, so capture the exact
        # bytes that the request body carries to compare against the stored row.
        p256dh = _valid_p256dh()
        response = client.post(
            "/api/admin/push/subscribe",
            json=_body(SUPER_ENDPOINT, p256dh=p256dh),
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["endpoint"] == SUPER_ENDPOINT
        assert data["user_id"] == admin_user.id
        row = db_session.query(models.AdminPushSubscription).filter_by(endpoint=SUPER_ENDPOINT).one()
        assert row.user_id == admin_user.id
        assert row.p256dh == p256dh

    def test_resubscribe_upserts_not_duplicates(self, client, db_session, auth_headers):
        first = client.post(
            "/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT, p256dh=_valid_p256dh()), headers=auth_headers
        )
        assert first.status_code == 200
        first_id = first.json()["id"]
        rotated = _valid_p256dh()
        second = client.post(
            "/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT, p256dh=rotated), headers=auth_headers
        )
        assert second.status_code == 200
        assert second.json()["id"] == first_id
        rows = db_session.query(models.AdminPushSubscription).all()
        assert len(rows) == 1
        assert rows[0].p256dh == rotated

    def test_editor_and_superuser_subscriptions_are_separate(self, client, db_session, auth_headers, editor_headers):
        client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        client.post("/api/admin/push/subscribe", json=_body(EDITOR_ENDPOINT), headers=editor_headers)
        rows = db_session.query(models.AdminPushSubscription).all()
        assert {r.endpoint for r in rows} == {SUPER_ENDPOINT, EDITOR_ENDPOINT}

    def test_list_subscriptions_only_returns_own(self, client, db_session, auth_headers, editor_headers):
        """GET /api/admin/push/subscriptions scopes to the requesting admin."""
        client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        client.post("/api/admin/push/subscribe", json=_body(EDITOR_ENDPOINT), headers=editor_headers)

        mine = client.get("/api/admin/push/subscriptions", headers=auth_headers)
        assert mine.status_code == 200
        items = mine.json()["items"]
        assert [i["endpoint"] for i in items] == [SUPER_ENDPOINT]

    def test_list_subscriptions_requires_admin_auth(self, client):
        response = client.get("/api/admin/push/subscriptions")
        assert response.status_code == 401


class TestAdminUnsubscribe:
    def test_removes_own_endpoint_only(self, client, db_session, auth_headers, editor_headers):
        client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        client.post("/api/admin/push/subscribe", json=_body(EDITOR_ENDPOINT), headers=editor_headers)

        # Superuser removes ONLY their own endpoint; the editor's row survives.
        response = client.post("/api/admin/push/unsubscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        assert response.status_code == 204
        remaining = db_session.query(models.AdminPushSubscription).all()
        assert [r.endpoint for r in remaining] == [EDITOR_ENDPOINT]

    def test_idempotent(self, client, auth_headers):
        response = client.post("/api/admin/push/unsubscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        assert response.status_code == 204
        response = client.post("/api/admin/push/unsubscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        assert response.status_code == 204

    def test_requires_admin_auth(self, client):
        response = client.post("/api/admin/push/unsubscribe", json=_body(SUPER_ENDPOINT))
        assert response.status_code == 401


class TestModerationDispatch:
    def test_pending_comment_create_pushes_subscribed_admins(self, client, db_session, auth_headers):
        """The moderation alert fires at CREATE (needs-approval), not approval."""
        post = _create_post(db_session, slug="mod-push-1")
        client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        with patch("app.webpush.send_push") as mock_send:
            created = _comment(client, post)
            assert created.status_code == 201, created.text
            assert mock_send.called, "a pending comment must push subscribed admins"
            args = mock_send.call_args.kwargs
            assert args["payload"]["url"] == "/admin/comments"
            assert "待审" in args["payload"]["title"]
            # The body carries a short preview (commenter + excerpt) so the
            # author can judge the comment before opening the queue.
            assert "Guest" in args["payload"]["body"]
            assert "new pending comment" in args["payload"]["body"]
        # The comment is pending, awaiting an admin.
        assert created.json()["is_approved"] is False

    def test_dispatch_does_not_touch_reader_subscriptions(self, client, db_session, auth_headers):
        """A reader PushSubscription must never receive the moderation fan-out."""
        post = _create_post(db_session, slug="mod-push-2")
        db_session.add(
            models.PushSubscription(
                endpoint="https://reader.example.com/sub",
                p256dh=_valid_p256dh(),
                auth=_valid_auth(),
                want_new_posts=False,
            )
        )
        db_session.flush()
        with patch("app.webpush.send_push") as mock_send:
            _comment(client, post)
            assert not mock_send.called, "reader subscriptions are not moderation targets"

    def test_dispatch_skips_non_admin_bound_rows(self, client, db_session, auth_headers):
        """A row whose user is not an admin role is never pushed (defense-in-depth)."""
        from app.auth import User, get_password_hash

        viewer = User(
            username="plainviewer", password=get_password_hash("pass12345"), role="viewer", is_superuser=False
        )
        db_session.add(viewer)
        db_session.flush()
        db_session.add(
            models.AdminPushSubscription(
                user_id=viewer.id,
                endpoint="https://viewer.example.com/sub",
                p256dh=_valid_p256dh(),
                auth=_valid_auth(),
            )
        )
        post = _create_post(db_session, slug="mod-push-3")
        with patch("app.webpush.send_push") as mock_send:
            _comment(client, post)
            assert not mock_send.called, "non-admin-bound rows must be filtered out"

    def test_no_subscriptions_silent_noop(self, client, db_session):
        post = _create_post(db_session, slug="mod-push-4")
        with patch("app.webpush.send_push") as mock_send:
            created = _comment(client, post)
            assert created.status_code == 201
            assert not mock_send.called

    def test_unconfigured_vapid_never_fails_comment_create(self, client, db_session, auth_headers, monkeypatch):
        post = _create_post(db_session, slug="mod-push-5")
        client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        created = _comment(client, post)
        assert created.status_code == 201, "moderation must never break comment create"

    def test_comment_on_draft_post_404_no_push(self, client, db_session, auth_headers):
        from app.crud import create_post

        draft = create_post(
            db_session,
            PostCreate(title="Draft", slug="mod-push-draft", content="# x", published=False),
        )
        client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)
        with patch("app.webpush.send_push") as mock_send:
            resp = client.post(
                f"/api/comments/post/{draft.id}",
                json={"nickname": "Guest", "email": "g@x.com", "content": "x"},
            )
            assert resp.status_code == 404
            assert not mock_send.called

    def test_dispatch_retires_dead_admin_subscription(self, client, db_session, auth_headers):
        from pywebpush import WebPushException

        post = _create_post(db_session, slug="mod-push-6")
        client.post("/api/admin/push/subscribe", json=_body(SUPER_ENDPOINT), headers=auth_headers)

        class DeadPush(WebPushException):
            def __init__(self):
                super().__init__("gone")
                self.response = type("R", (), {"status_code": 410})()

        with patch("app.webpush.send_push", side_effect=DeadPush) as mock_send:
            resp = _comment(client, post)
            assert resp.status_code == 201, resp.text
            assert mock_send.called
        remaining = db_session.query(models.AdminPushSubscription).filter_by(endpoint=SUPER_ENDPOINT).all()
        assert remaining == [], "the dead admin endpoint should be retired on dispatch"
