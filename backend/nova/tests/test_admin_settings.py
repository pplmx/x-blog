"""Admin runtime settings endpoints + their effect on the comment trust tier
(DEC-100, TASK-162).

The verified-reader auto-approve toggle is an operator-controlled site setting:
a persisted value overrides the env fallback the comment-create path reads, so
an admin can flip it at runtime without a redeploy.
"""

from app.crud import create_post
from app.schemas import PostCreate

SETTINGS_URL = "/api/admin/settings/auto_approve_reader_comments"


def _make_post(db_session, slug="settings-post"):
    return create_post(
        db_session,
        PostCreate(title="Settings Post", slug=slug, content="# Hi", published=True),
    )


def _reader_headers(client, email="settings@example.com"):
    resp = client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": "Settings Reader"},
    )
    assert resp.status_code == 201
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


class TestAdminAuth:
    def test_get_setting_requires_admin(self, client):
        assert client.get(SETTINGS_URL).status_code == 401

    def test_put_setting_requires_admin(self, client):
        assert client.put(SETTINGS_URL, json={"value": "true"}).status_code == 401


class TestGetDefault:
    def test_effective_value_is_false_when_unset(self, client, auth_headers):
        resp = client.get(SETTINGS_URL, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == {"key": "auto_approve_reader_comments", "value": "false"}

    def test_unknown_key_404(self, client, auth_headers):
        assert client.get("/api/admin/settings/nope", headers=auth_headers).status_code == 404


class TestPutPersists:
    def test_put_true_then_get_true(self, client, auth_headers):
        put = client.put(SETTINGS_URL, json={"value": "true"}, headers=auth_headers)
        assert put.status_code == 200
        assert put.json()["value"] == "true"
        got = client.get(SETTINGS_URL, headers=auth_headers)
        assert got.json()["value"] == "true"

    def test_put_invalid_value_422(self, client, auth_headers):
        resp = client.put(SETTINGS_URL, json={"value": "banana"}, headers=auth_headers)
        assert resp.status_code == 422

    def test_put_unknown_key_404(self, client, auth_headers):
        resp = client.put("/api/admin/settings/nope", json={"value": "true"}, headers=auth_headers)
        assert resp.status_code == 404


class TestAffectsCommentTrustTier:
    def test_persisted_true_auto_approves_verified_reader(self, client, db_session, auth_headers):
        post = _make_post(db_session, slug="sett-auto-on")
        assert client.put(SETTINGS_URL, json={"value": "true"}, headers=auth_headers).status_code == 200

        headers = _reader_headers(client, "sett-true@example.com")
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "x", "email": "x@x.com", "content": "trusted hello"},
            headers=headers,
        ).json()
        # Persisted "true" wins over the (off) env fallback.
        assert created["is_approved"] is True

    def test_persisted_false_overrides_env_true(self, client, db_session, auth_headers, monkeypatch):
        from app.routers import comments as comments_router

        # Even if the env side were on, a persisted "false" must keep pending.
        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        post = _make_post(db_session, slug="sett-auto-off")
        assert client.put(SETTINGS_URL, json={"value": "false"}, headers=auth_headers).status_code == 200

        headers = _reader_headers(client, "sett-false@example.com")
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "x", "email": "x@x.com", "content": "still moderated"},
            headers=headers,
        ).json()
        assert created["is_approved"] is False
