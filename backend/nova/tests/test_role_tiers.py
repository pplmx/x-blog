"""Contract tests for role-tier admin access control (DEC-054, TASK-107/114/115/116).

Covers the role model contract added by the milestone:
- GET /api/admin/me returns the current account's role (drives role-aware UI).
- A non-superuser editor CAN moderate content (posts/comments/categories/tags).
- A non-superuser editor CANNOT manage users, export CSV, or batch-approve.
- Created accounts are non-superuser editors (ISS-087 safe contract, DEC-053).
- GET /api/admin/me requires an authenticated admin (401 otherwise).
"""


class TestMeEndpoint:
    """Tests for GET /api/admin/me (role disclosure for role-aware UI)."""

    def test_me_returns_role_and_superuser(self, client, auth_headers):
        response = client.get("/api/admin/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "testadmin"
        assert data["role"] == "superuser"
        assert data["is_superuser"] is True

    def test_me_returns_editor_role(self, client, editor_headers):
        response = client.get("/api/admin/me", headers=editor_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "editor"
        assert data["is_superuser"] is False

    def test_me_requires_auth(self, client):
        response = client.get("/api/admin/me")
        assert response.status_code == 401


class TestEditorCanModerateContent:
    """Non-superuser editors can moderate posts/comments/categories/tags."""

    def test_editor_can_list_posts(self, client, editor_headers):
        response = client.get("/api/admin/posts", headers=editor_headers)
        assert response.status_code == 200
        assert "items" in response.json()

    def test_editor_can_create_post(self, client, editor_headers):
        response = client.post(
            "/api/admin/posts",
            headers=editor_headers,
            json={
                "title": "Editor Draft",
                "slug": "editor-draft",
                "content": "Body",
                "published": False,
            },
        )
        assert response.status_code == 201

    def test_editor_can_create_category(self, client, editor_headers):
        response = client.post(
            "/api/admin/categories",
            headers=editor_headers,
            json={"name": "EditorCat"},
        )
        assert response.status_code == 200

    def test_editor_can_approve_comment(self, client, editor_headers, db_session):
        # create a post + comment, then approve via the editor
        from app import models

        post = models.Post(title="P", slug="p-role", content="c", published=True, publish_at=None)
        db_session.add(post)
        db_session.flush()
        comment = models.Comment(
            post_id=post.id,
            nickname="n",
            email="n@example.com",
            content="hello",
            ip_address="127.0.0.1",
            is_approved=False,
        )
        db_session.add(comment)
        db_session.flush()
        response = client.patch(
            f"/api/comments/{comment.id}/approve",
            headers=editor_headers,
            json={"approved": True},
        )
        assert response.status_code == 200
        assert response.json()["is_approved"] is True


class TestEditorCannotPrivileged:
    """Non-superuser editors cannot manage users, export, or batch-approve."""

    def test_editor_cannot_list_users(self, client, editor_headers):
        response = client.get("/api/admin/users", headers=editor_headers)
        assert response.status_code == 403

    def test_editor_cannot_create_user(self, client, editor_headers):
        response = client.post(
            "/api/admin/users",
            headers=editor_headers,
            json={"username": "hacker", "password": "password123"},
        )
        assert response.status_code == 403

    def test_editor_cannot_export_posts(self, client, editor_headers):
        response = client.get("/api/export/posts.csv", headers=editor_headers)
        assert response.status_code == 403

    def test_editor_cannot_export_comments(self, client, editor_headers):
        response = client.get("/api/export/comments.csv", headers=editor_headers)
        assert response.status_code == 403

    def test_editor_cannot_batch_approve(self, client, editor_headers):
        response = client.post(
            "/api/admin/comments/batch-approve",
            headers=editor_headers,
            json={"ids": [1], "approved": True},
        )
        assert response.status_code == 403


class TestCreateUserRole:
    """Created accounts are non-superuser editors (ISS-087 safe contract)."""

    def test_created_user_is_non_superuser_editor(self, client, db_session, admin_user, auth_headers):
        # admin_user is a no-op dependency pointer in the transaction; pass it to
        # guarantee the superuser exists for login.
        _ = admin_user
        response = client.post(
            "/api/admin/users",
            headers=auth_headers,
            json={"username": "neweditor", "password": "password123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["role"] == "editor"
        assert data["is_superuser"] is False

    def test_created_user_can_login_and_me_shows_editor(self, client, db_session, admin_user, auth_headers):
        _ = admin_user
        client.post(
            "/api/admin/users",
            headers=auth_headers,
            json={"username": "provisioned", "password": "password123"},
        )
        login = client.post(
            "/api/admin/login",
            data={"username": "provisioned", "password": "password123"},
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        me = client.get("/api/admin/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["role"] == "editor"
