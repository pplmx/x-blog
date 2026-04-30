"""Tests for admin user management endpoints."""

from sqlalchemy.orm import Session

from app.auth import User, get_password_hash


class TestCreateUser:
    """Tests for POST /api/admin/users endpoint."""

    def test_create_user_success(self, client, admin_user, auth_headers):
        """Admin can create a new user with valid data."""
        response = client.post(
            "/api/admin/users",
            json={"username": "newuser", "password": "password123"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "newuser"
        assert data["is_superuser"] is False
        assert "id" in data
        assert "password" not in data  # Password should not be returned

    def test_create_user_auth_required(self, client, admin_user):
        """Request without token should return 401."""
        response = client.post(
            "/api/admin/users",
            json={"username": "newuser", "password": "password123"},
        )
        assert response.status_code == 401

    def test_create_user_non_admin_forbidden(self, client, db_session: Session, admin_user):
        """Regular user cannot create users."""
        # Create a regular (non-admin) user
        regular_user = User(
            username="regularuser",
            password=get_password_hash("regularpass123"),
            is_superuser=False,
        )
        db_session.add(regular_user)
        db_session.flush()

        # Login as regular user
        login_response = client.post(
            "/api/admin/login",
            data={"username": "regularuser", "password": "regularpass123"},
        )
        assert login_response.status_code == 200
        regular_token = login_response.json()["access_token"]
        regular_headers = {"Authorization": f"Bearer {regular_token}"}

        # Try to create user as non-admin
        response = client.post(
            "/api/admin/users",
            json={"username": "someuser", "password": "password123"},
            headers=regular_headers,
        )
        assert response.status_code == 403

    def test_create_user_duplicate_username(self, client, admin_user, auth_headers):
        """Duplicate username should return 400."""
        # Create first user
        response1 = client.post(
            "/api/admin/users",
            json={"username": "duplicateuser", "password": "password123"},
            headers=auth_headers,
        )
        assert response1.status_code == 200

        # Try to create user with same username
        response2 = client.post(
            "/api/admin/users",
            json={"username": "duplicateuser", "password": "differentpass"},
            headers=auth_headers,
        )
        assert response2.status_code == 400
        # Check error response format (uses custom error format)
        error_data = response2.json()
        assert "error" in error_data
        error_msg = error_data["error"].get("message", "").lower()
        assert "already exists" in error_msg

    def test_create_user_with_invalid_data(self, client, admin_user, auth_headers):
        """Invalid data should return validation error."""
        # Missing required fields
        response = client.post(
            "/api/admin/users",
            json={"username": "testuser"},
            headers=auth_headers,
        )
        assert response.status_code == 422


class TestListUsers:
    """Tests for GET /api/admin/users endpoint."""

    def test_list_users_success(self, client, admin_user, auth_headers):
        """Admin can list all users."""
        # Create a couple of users first
        client.post(
            "/api/admin/users",
            json={"username": "user1", "password": "pass1"},
            headers=auth_headers,
        )
        client.post(
            "/api/admin/users",
            json={"username": "user2", "password": "pass2"},
            headers=auth_headers,
        )

        # List users
        response = client.get("/api/admin/users", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        # Should include admin, user1, and user2
        assert len(data) >= 3
        usernames = [u["username"] for u in data]
        assert "testadmin" in usernames
        assert "user1" in usernames
        assert "user2" in usernames

    def test_list_users_auth_required(self, client, admin_user):
        """Request without token should return 401."""
        response = client.get("/api/admin/users")
        assert response.status_code == 401

    def test_list_users_non_admin_forbidden(self, client, db_session: Session, admin_user):
        """Regular user cannot list all users."""
        # Create a regular user
        regular_user = User(
            username="regularuser",
            password=get_password_hash("regularpass123"),
            is_superuser=False,
        )
        db_session.add(regular_user)
        db_session.flush()

        # Login as regular user
        login_response = client.post(
            "/api/admin/login",
            data={"username": "regularuser", "password": "regularpass123"},
        )
        regular_token = login_response.json()["access_token"]
        regular_headers = {"Authorization": f"Bearer {regular_token}"}

        # Try to list users as non-admin
        response = client.get("/api/admin/users", headers=regular_headers)
        assert response.status_code == 403


class TestDeleteUser:
    """Tests for DELETE /api/admin/users/{user_id} endpoint."""

    def test_delete_user_success(self, client, admin_user, auth_headers):
        """Admin can delete a user."""
        # Create a user to delete
        create_response = client.post(
            "/api/admin/users",
            json={"username": "usertobedeleted", "password": "password123"},
            headers=auth_headers,
        )
        assert create_response.status_code == 200
        user_id = create_response.json()["id"]

        # Delete the user
        delete_response = client.delete(
            f"/api/admin/users/{user_id}",
            headers=auth_headers,
        )
        assert delete_response.status_code == 200
        assert "deleted" in delete_response.json()["message"].lower()

    def test_delete_user_cannot_delete_self(self, client, admin_user, auth_headers):
        """Admin cannot delete themselves."""
        # Try to delete the admin user (id = admin_user.id)
        response = client.delete(
            f"/api/admin/users/{admin_user.id}",
            headers=auth_headers,
        )
        assert response.status_code == 400
        # Check error response format (uses custom error format)
        error_data = response.json()
        assert "error" in error_data
        error_msg = error_data["error"].get("message", "").lower()
        assert "delete yourself" in error_msg

    def test_delete_user_not_found(self, client, admin_user, auth_headers):
        """Deleting non-existent user returns 404."""
        response = client.delete(
            "/api/admin/users/99999",
            headers=auth_headers,
        )
        assert response.status_code == 404
        # Check error response format (uses custom error format)
        error_data = response.json()
        assert "error" in error_data
        error_msg = error_data["error"].get("message", "").lower()
        assert "not found" in error_msg

    def test_delete_user_auth_required(self, client, admin_user):
        """Request without token should return 401."""
        response = client.delete("/api/admin/users/1")
        assert response.status_code == 401

    def test_delete_user_non_admin_forbidden(self, client, db_session: Session, admin_user, auth_headers):
        """Regular user cannot delete users."""
        # Create a regular user
        regular_user = User(
            username="regularuser",
            password=get_password_hash("regularpass123"),
            is_superuser=False,
        )
        db_session.add(regular_user)
        db_session.flush()

        # Create another user to try deleting
        create_response = client.post(
            "/api/admin/users",
            json={"username": "targetuser", "password": "password123"},
            headers=auth_headers,
        )
        target_id = create_response.json()["id"]

        # Login as regular user
        login_response = client.post(
            "/api/admin/login",
            data={"username": "regularuser", "password": "regularpass123"},
        )
        regular_token = login_response.json()["access_token"]
        regular_headers = {"Authorization": f"Bearer {regular_token}"}

        # Try to delete as non-admin
        response = client.delete(
            f"/api/admin/users/{target_id}",
            headers=regular_headers,
        )
        assert response.status_code == 403
