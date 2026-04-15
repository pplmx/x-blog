# ruff: noqa: ARG001
"""Tests for authentication and authorization."""

import pytest

from app.auth import User, get_password_hash


@pytest.fixture
def admin_user(db_session):
    """Create admin user in database."""
    user = User(
        username="admin",
        password=get_password_hash("admin123"),
        is_superuser=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


# ============ Login Tests ============


def test_login_success(client, admin_user):
    """Valid credentials should return token."""
    response = client.post(
        "/api/admin/login",
        data={
            "username": "admin",
            "password": "admin123",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password(client, admin_user):
    """Wrong password should return 401."""
    response = client.post(
        "/api/admin/login",
        data={
            "username": "admin",
            "password": "wrongpassword",
        },
    )
    assert response.status_code == 401


def test_login_wrong_username(client):
    """Wrong username should return 401."""
    response = client.post(
        "/api/admin/login",
        data={
            "username": "wronguser",
            "password": "admin123",
        },
    )
    assert response.status_code == 401


def test_login_empty_credentials(client):
    """Empty credentials should return 422."""
    response = client.post("/api/admin/login", data={})
    assert response.status_code == 422


def test_login_missing_password(client):
    """Missing password should return 422."""
    response = client.post(
        "/api/admin/login",
        data={"username": "admin"},
    )
    assert response.status_code == 422


def test_login_missing_username(client):
    """Missing username should return 422."""
    response = client.post(
        "/api/admin/login",
        data={"password": "admin123"},
    )
    assert response.status_code == 422


def test_login_invalid_content_type(client, admin_user):
    """Invalid content type should return 422."""
    response = client.post(
        "/api/admin/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert response.status_code == 422


# ============ Token Tests ============


def test_token_format(client, admin_user):
    """Token should be a non-empty string."""
    response = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )
    token = response.json()["access_token"]
    assert isinstance(token, str)
    assert len(token) > 0


def test_protected_endpoint_without_token(client):
    """Protected endpoints without token should return 401."""
    response = client.get("/api/admin/posts")
    assert response.status_code == 401


def test_protected_endpoint_with_invalid_token(client):
    """Protected endpoints with invalid token should return 401."""
    response = client.get(
        "/api/admin/posts",
        headers={"Authorization": "Bearer invalid_token"},
    )
    assert response.status_code == 401


def test_protected_endpoint_with_malformed_header(client):
    """Malformed Authorization header should return 401."""
    response = client.get(
        "/api/admin/posts",
        headers={"Authorization": "invalid_header"},
    )
    assert response.status_code == 401


def test_protected_endpoint_with_partial_token(client):
    """Incomplete token should return 401."""
    response = client.get(
        "/api/admin/posts",
        headers={"Authorization": "Bearer "},
    )
    assert response.status_code == 401


# ============ Admin CRUD Authorization ============


def test_admin_list_posts_requires_auth(client):
    """Admin posts list requires authentication."""
    response = client.get("/api/admin/posts")
    assert response.status_code == 401


def test_admin_create_post_requires_auth(client):
    """Creating posts requires authentication."""
    response = client.post(
        "/api/admin/posts",
        json={
            "title": "Unauthorized Post",
            "slug": "unauthorized",
            "content": "Content",
        },
    )
    assert response.status_code == 401


def test_admin_delete_post_requires_auth(client):
    """Deleting posts requires authentication."""
    response = client.delete("/api/admin/posts/1")
    assert response.status_code == 401


def test_admin_list_categories_requires_auth(client):
    """Admin categories list requires authentication."""
    response = client.get("/api/admin/categories")
    assert response.status_code == 401


def test_admin_create_category_requires_auth(client):
    """Creating categories requires authentication."""
    response = client.post(
        "/api/admin/categories",
        json={"name": "Unauthorized Category"},
    )
    assert response.status_code == 401


def test_admin_list_tags_requires_auth(client):
    """Admin tags list requires authentication."""
    response = client.get("/api/admin/tags")
    assert response.status_code == 401


def test_admin_comments_requires_auth(client):
    """Admin comments requires authentication."""
    response = client.get("/api/admin/comments")
    assert response.status_code == 401


# ============ Authenticated Operations ============


@pytest.fixture(scope="function")
def auth_token(client, admin_user):
    """Get authentication token."""
    response = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )
    return response.json()["access_token"]


def test_admin_list_posts_with_auth(client, auth_token):
    """Admin posts list works with valid token."""
    response = client.get(
        "/api/admin/posts",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_admin_create_post_with_auth(client, auth_token):
    """Creating posts works with valid token."""
    response = client.post(
        "/api/admin/posts",
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json",
        },
        json={
            "title": "Auth Post",
            "slug": "auth-post",
            "content": "Content",
            "published": False,
        },
    )
    # Returns 201 (created) or 200 depending on implementation
    assert response.status_code in [200, 201]
    data = response.json()
    assert "id" in data


def test_admin_create_category_with_auth(client, auth_token):
    """Creating categories works with valid token."""
    response = client.post(
        "/api/admin/categories?name=Auth+Category",
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    assert response.status_code in [200, 201]
    data = response.json()
    assert "id" in data


def test_admin_create_tag_with_auth(client, auth_token):
    """Creating tags works with valid token."""
    response = client.post(
        "/api/admin/tags?name=AuthTag",
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    assert response.status_code in [200, 201]
    data = response.json()
    assert "id" in data


def test_admin_delete_category_with_auth(client, auth_token):
    """Deleting categories works with valid token."""
    # Create a category first
    create_response = client.post(
        "/api/admin/categories?name=DeleteMe",
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    assert create_response.status_code in [200, 201]
    category_id = create_response.json()["id"]

    # Delete it
    response = client.delete(
        f"/api/admin/categories/{category_id}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert response.status_code in [204, 200]


def test_admin_delete_tag_with_auth(client, auth_token):
    """Deleting tags works with valid token."""
    # Create a tag first
    create_response = client.post(
        "/api/admin/tags?name=DeleteMeTag",
        headers={
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    assert create_response.status_code in [200, 201]
    tag_id = create_response.json()["id"]

    # Delete it
    response = client.delete(
        f"/api/admin/tags/{tag_id}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert response.status_code in [204, 200]


# ============ Token Expiration / Invalidity ============


def test_token_with_extra_characters(client, admin_user):
    """Token with extra characters should be invalid."""
    response = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )
    token = response.json()["access_token"]
    # Add extra character
    invalid_token = token + "x"

    response = client.get(
        "/api/admin/posts",
        headers={"Authorization": f"Bearer {invalid_token}"},
    )
    assert response.status_code == 401


def test_token_with_truncated_value(client, admin_user):
    """Truncated token should be invalid."""
    response = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )
    token = response.json()["access_token"]
    # Take only first half
    invalid_token = token[: len(token) // 2]

    response = client.get(
        "/api/admin/posts",
        headers={"Authorization": f"Bearer {invalid_token}"},
    )
    assert response.status_code == 401


# ============ Multiple Auth Scenarios ============


def test_multiple_login_requests(client, admin_user):
    """Multiple login requests should each return valid token."""
    response1 = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )
    response2 = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )

    assert response1.status_code == 200
    assert response2.status_code == 200
    assert "access_token" in response1.json()
    assert "access_token" in response2.json()
    # Tokens can be same or different depending on implementation


def test_concurrent_requests_with_same_token(client, auth_token):
    """Multiple concurrent requests with same token should all succeed."""
    responses = []
    for _ in range(5):
        response = client.get(
            "/api/admin/posts",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        responses.append(response)

    assert all(r.status_code == 200 for r in responses)
