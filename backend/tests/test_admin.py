# ruff: noqa: ARG001
"""Tests for admin CRUD operations.

Uses shared fixtures from conftest.py: admin_user, admin_token, auth_headers.
Credentials: username="testadmin", password="testpass123"
"""

import pytest

from app import models


class TestAdminLogin:
    def test_login_success(self, client, admin_user):
        response = client.post(
            "/api/admin/login",
            data={"username": "testadmin", "password": "testpass123"},
        )
        assert response.status_code == 200
        assert "access_token" in response.json()

    def test_login_wrong_password(self, client, admin_user):
        response = client.post(
            "/api/admin/login",
            data={"username": "testadmin", "password": "wrongpassword"},
        )
        assert response.status_code == 401

    def test_login_nonexistent_user(self, client):
        response = client.post(
            "/api/admin/login",
            data={"username": "nonexistent", "password": "testpass123"},
        )
        assert response.status_code == 401


class TestAdminPosts:
    def test_list_posts(self, client, auth_headers, db_session):
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()

        response = client.get("/api/admin/posts", headers=auth_headers)
        assert response.status_code == 200
        posts = response.json()
        assert len(posts) == 1

    def test_create_post(self, client, auth_headers):
        response = client.post(
            "/api/admin/posts",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={
                "title": "New Post",
                "slug": "new-post",
                "content": "Post content",
                "published": True,
            },
        )
        assert response.status_code in [200, 201]
        assert response.json()["id"] == 1

    def test_get_post(self, client, auth_headers, db_session):
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        response = client.get(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["title"] == "Test"

    def test_update_post(self, client, auth_headers, db_session):
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        response = client.put(
            f"/api/admin/posts/{post_id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"title": "Updated Title", "slug": "updated-slug"},
        )
        assert response.status_code == 200

    def test_delete_post(self, client, auth_headers, db_session):
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        response = client.delete(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code in [200, 204]

    def test_list_posts_unauthorized(self, client):
        response = client.get("/api/admin/posts")
        assert response.status_code == 401


class TestAdminCategories:
    def test_list_categories(self, client, auth_headers, db_session):
        category = models.Category(name="Test Category")
        db_session.add(category)
        db_session.commit()

        response = client.get("/api/admin/categories", headers=auth_headers)
        assert response.status_code == 200

    def test_create_category(self, client, auth_headers):
        response = client.post(
            "/api/admin/categories?name=New%20Category",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
        )
        assert response.status_code in [200, 201]

    def test_delete_category(self, client, auth_headers, db_session):
        category = models.Category(name="Test")
        db_session.add(category)
        db_session.commit()
        cat_id = category.id

        response = client.delete(f"/api/admin/categories/{cat_id}", headers=auth_headers)
        assert response.status_code in [200, 204]


class TestAdminTags:
    def test_list_tags(self, client, auth_headers, db_session):
        tag = models.Tag(name="Test Tag")
        db_session.add(tag)
        db_session.commit()

        response = client.get("/api/admin/tags", headers=auth_headers)
        assert response.status_code == 200

    def test_create_tag(self, client, auth_headers):
        response = client.post(
            "/api/admin/tags?name=NewTag",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
        )
        assert response.status_code in [200, 201]

    def test_delete_tag(self, client, auth_headers, db_session):
        tag = models.Tag(name="Test")
        db_session.add(tag)
        db_session.commit()
        tag_id = tag.id

        response = client.delete(f"/api/admin/tags/{tag_id}", headers=auth_headers)
        assert response.status_code in [200, 204]