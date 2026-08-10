# ruff: noqa: ARG001
"""Tests for admin CRUD operations.

Uses shared fixtures from conftest.py: admin_user, admin_token, auth_headers.
Credentials: username="testadmin", password="testpass123"
"""

from unittest.mock import patch

from sqlalchemy.exc import IntegrityError

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
        data = response.json()
        assert len(data["items"]) == 1
        assert data["pagination"]["total"] == 1

    def test_admin_list_posts_sorted_by_created_at_desc(self, client, auth_headers, db_session):
        """Admin post list must return posts sorted by created_at descending.

        Without explicit ordering, SQLite offset/limit pagination is non-deterministic,
        causing duplicate or missing items across pages.
        """
        from datetime import UTC, datetime

        posts = []
        for i, title in enumerate(["First", "Second", "Third"]):
            post = models.Post(
                title=title,
                slug=f"sort-test-{i}",
                content="Content",
                published=True,
                created_at=datetime(2024, 1, i + 1, 12, 0, 0, tzinfo=UTC),
            )
            posts.append(post)
        db_session.add_all(posts)
        db_session.commit()

        response = client.get("/api/admin/posts", headers=auth_headers)
        assert response.status_code == 200
        result = response.json()
        titles = [p["title"] for p in result["items"]]
        assert titles == ["Third", "Second", "First"]

    def test_admin_list_posts_pinned_first(self, client, auth_headers, db_session):
        """Pinned posts must appear before non-pinned posts (matching public listing)."""
        from datetime import UTC, datetime

        pinned = models.Post(
            title="Pinned Post",
            slug="pinned-sort-test",
            content="Content",
            published=True,
            pinned=True,
            created_at=datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC),
        )
        regular = models.Post(
            title="Regular Post",
            slug="regular-sort-test",
            content="Content",
            published=True,
            pinned=False,
            created_at=datetime(2024, 6, 1, 12, 0, 0, tzinfo=UTC),
        )
        db_session.add_all([pinned, regular])
        db_session.commit()

        response = client.get("/api/admin/posts", headers=auth_headers)
        assert response.status_code == 200
        result = response.json()
        titles = [p["title"] for p in result["items"]]
        assert titles[0] == "Pinned Post"
        assert "Regular Post" in titles

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

    def test_update_post_preserves_category_id(self, client, auth_headers, db_session):
        """Updating a post without category_id should not clear the existing category."""
        category = models.Category(name="Tech")
        db_session.add(category)
        db_session.commit()

        post = models.Post(
            title="Test",
            slug="test",
            content="Content",
            published=True,
            category_id=category.id,
        )
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        # Update only title — category_id should be preserved
        response = client.put(
            f"/api/admin/posts/{post_id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"title": "Updated Title"},
        )
        assert response.status_code == 200

        # Verify the category_id was not cleared
        updated = client.get(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert updated.status_code == 200
        assert updated.json()["category_id"] == category.id

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
            "/api/admin/categories",
            json={"name": "New Category"},
            headers=auth_headers,
        )
        assert response.status_code in [200, 201]
        assert response.json()["name"] == "New Category"

    def test_create_category_missing_name(self, client, auth_headers):
        """Missing body name must be a 422, not a silent query-param read."""
        response = client.post(
            "/api/admin/categories",
            headers=auth_headers,
        )
        assert response.status_code == 422

    def test_update_category(self, client, auth_headers, db_session):
        category = models.Category(name="Old Name")
        db_session.add(category)
        db_session.commit()

        response = client.put(
            f"/api/admin/categories/{category.id}",
            json={"name": "Renamed"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Renamed"

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
            "/api/admin/tags",
            json={"name": "NewTag"},
            headers=auth_headers,
        )
        assert response.status_code in [200, 201]
        assert response.json()["name"] == "NewTag"

    def test_update_tag(self, client, auth_headers, db_session):
        tag = models.Tag(name="Old Tag")
        db_session.add(tag)
        db_session.commit()

        response = client.put(
            f"/api/admin/tags/{tag.id}",
            json={"name": "Renamed Tag"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Renamed Tag"

    def test_delete_tag(self, client, auth_headers, db_session):
        tag = models.Tag(name="Test")
        db_session.add(tag)
        db_session.commit()
        tag_id = tag.id

        response = client.delete(f"/api/admin/tags/{tag_id}", headers=auth_headers)
        assert response.status_code in [200, 204]


class TestAdminDeleteForeignKey:
    """Tests for admin delete endpoints with foreign key constraints."""

    def test_delete_category_with_posts_returns_400(self, client, auth_headers, db_session):
        """Test deleting a category with posts returns 400, not 500."""
        category = models.Category(name="Protected Cat")
        db_session.add(category)
        db_session.flush()

        post = models.Post(
            title="Post with Cat",
            slug="post-with-protected-cat",
            content="Content",
            category_id=category.id,
        )
        db_session.add(post)
        db_session.commit()

        response = client.delete(f"/api/admin/categories/{category.id}", headers=auth_headers)
        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_delete_category_without_posts(self, client, auth_headers, db_session):
        """Test deleting a category without posts succeeds."""
        category = models.Category(name="Empty Cat")
        db_session.add(category)
        db_session.commit()
        cat_id = category.id

        response = client.delete(f"/api/admin/categories/{cat_id}", headers=auth_headers)
        assert response.status_code in [200, 204]

    def test_delete_tag_with_posts_returns_400(self, client, auth_headers, db_session):
        """Test deleting a tag with posts returns 400, not 500."""
        tag = models.Tag(name="Protected Tag")
        db_session.add(tag)
        db_session.flush()

        post = models.Post(
            title="Post with Tag",
            slug="post-with-protected-tag",
            content="Content",
        )
        post.tags.append(tag)
        db_session.add(post)
        db_session.commit()

        response = client.delete(f"/api/admin/tags/{tag.id}", headers=auth_headers)
        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_delete_tag_without_posts(self, client, auth_headers, db_session):
        """Test deleting a tag without posts succeeds."""
        tag = models.Tag(name="Unused Tag")
        db_session.add(tag)
        db_session.commit()
        tag_id = tag.id

        response = client.delete(f"/api/admin/tags/{tag_id}", headers=auth_headers)
        assert response.status_code in [200, 204]

    def test_delete_category_not_found(self, client, auth_headers):
        """Test deleting a non-existent category returns 404."""
        response = client.delete("/api/admin/categories/99999", headers=auth_headers)
        assert response.status_code == 404

    def test_delete_tag_not_found(self, client, auth_headers):
        """Test deleting a non-existent tag returns 404."""
        response = client.delete("/api/admin/tags/99999", headers=auth_headers)
        assert response.status_code == 404


class TestAdminPostNotFoundPaths:
    """Tests for admin post endpoints when post doesn't exist."""

    def test_get_post_not_found(self, client, auth_headers):
        """Test getting a non-existent post returns 404."""
        response = client.get("/api/admin/posts/99999", headers=auth_headers)
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == "NOT_FOUND"

    def test_update_post_not_found(self, client, auth_headers):
        """Test updating a non-existent post returns 404."""
        response = client.put(
            "/api/admin/posts/99999",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"title": "Updated Title"},
        )
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == "NOT_FOUND"

    def test_delete_post_not_found(self, client, auth_headers):
        """Test deleting a non-existent post returns 404."""
        response = client.delete("/api/admin/posts/99999", headers=auth_headers)
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == "NOT_FOUND"


class TestAdminCategoryErrors:
    """Tests for category conflict and not-found error paths."""

    def test_create_category_already_exists(self, client, auth_headers, db_session):
        """Test creating a duplicate category returns 400."""
        category = models.Category(name="Duplicate")
        db_session.add(category)
        db_session.commit()

        response = client.post(
            "/api/admin/categories",
            json={"name": "Duplicate"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == "BAD_REQUEST"

    def test_update_category_not_found(self, client, auth_headers):
        """Test updating a non-existent category returns 404."""
        response = client.put(
            "/api/admin/categories/99999",
            json={"name": "NewName"},
            headers=auth_headers,
        )
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == "NOT_FOUND"


class TestAdminTagErrors:
    """Tests for tag conflict and not-found error paths."""

    def test_create_tag_already_exists(self, client, auth_headers, db_session):
        """Test creating a duplicate tag returns 400."""
        tag = models.Tag(name="DuplicateTag")
        db_session.add(tag)
        db_session.commit()

        response = client.post(
            "/api/admin/tags",
            json={"name": "DuplicateTag"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == "BAD_REQUEST"

    def test_update_tag_not_found(self, client, auth_headers):
        """Test updating a non-existent tag returns 404."""
        response = client.put(
            "/api/admin/tags/99999",
            json={"name": "NewName"},
            headers=auth_headers,
        )
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == "NOT_FOUND"


class TestAdminComments:
    """Tests for admin comment management endpoints."""

    def _create_comment(self, db_session, post=None, nickname="Commenter", content="Nice post!"):
        """Helper to create a comment in the DB."""
        if post is None:
            post = models.Post(title="Test Post", slug="test-post", content="Content", published=True)
            db_session.add(post)
            db_session.commit()
        comment = models.Comment(
            post_id=post.id,
            nickname=nickname,
            email="commenter@test.com",
            content=content,
        )
        db_session.add(comment)
        db_session.commit()
        return comment, post

    def test_list_comments(self, client, auth_headers, db_session):
        """Test listing all comments."""
        comment, post = self._create_comment(db_session)

        response = client.get("/api/admin/comments", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        comments = data["items"]
        assert len(comments) == 1
        assert comments[0]["nickname"] == "Commenter"
        assert comments[0]["content"] == "Nice post!"
        assert comments[0]["post_id"] == post.id
        assert comments[0]["post_title"] == post.title
        assert data["pagination"]["total"] == 1

    def test_list_comments_filtered_by_post_id(self, client, auth_headers, db_session):
        """Test listing comments filtered by post_id."""
        post1 = models.Post(title="Post One", slug="post-one", content="Content", published=True)
        post2 = models.Post(title="Post Two", slug="post-two", content="Content", published=True)
        db_session.add_all([post1, post2])
        db_session.commit()

        self._create_comment(db_session, post1, nickname="Alice", content="First post!")
        self._create_comment(db_session, post2, nickname="Bob", content="Second post!")

        response = client.get(f"/api/admin/comments?post_id={post1.id}", headers=auth_headers)
        assert response.status_code == 200
        comments = response.json()["items"]
        assert len(comments) == 1
        assert comments[0]["nickname"] == "Alice"
        assert comments[0]["post_id"] == post1.id
        assert comments[0]["post_title"] == "Post One"

    def test_list_comments_empty(self, client, auth_headers):
        """Test listing comments when no comments exist."""
        response = client.get("/api/admin/comments", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["pagination"]["total"] == 0

    def test_list_comments_paginated(self, client, auth_headers, db_session):
        """Pagination bounds the admin comments response (issue #20)."""
        from datetime import UTC, datetime, timedelta

        post = models.Post(title="Pagination Post", slug="pagination-post", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        base = datetime(2026, 1, 1, tzinfo=UTC)
        for i in range(5):
            db_session.add(
                models.Comment(
                    post_id=post.id,
                    nickname=f"User{i}",
                    email=f"user{i}@test.com",
                    content=f"Comment number {i}",
                    created_at=base + timedelta(minutes=i),
                )
            )
        db_session.commit()

        response = client.get("/api/admin/comments?page=1&limit=2", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["pagination"]["total"] == 5
        assert data["pagination"]["total_pages"] == 3
        # Newest first
        assert data["items"][0]["content"] == "Comment number 4"

    def test_delete_comment(self, client, auth_headers, db_session):
        """Test deleting an existing comment."""
        comment, _ = self._create_comment(db_session)

        response = client.delete(f"/api/admin/comments/{comment.id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["message"] == "Comment deleted"

    def test_delete_comment_not_found(self, client, auth_headers):
        """Test deleting a non-existent comment returns 404."""
        response = client.delete("/api/admin/comments/99999", headers=auth_headers)
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == "NOT_FOUND"

    def test_delete_comment_with_replies_returns_400(self, client, auth_headers, db_session):
        """Deleting a parent comment that has replies must return 400, not 500.

        On PostgreSQL the self-referential ``parent_id`` FK raises IntegrityError
        when the route issues a bare ``DELETE`` (the request session only loaded
        the parent, never the replies). The route catches it, rolls back, and
        returns a 400.

        The FK violation is reproduced deterministically with a mocked commit:
        the ORM cascade + SQLite make a real FK-triggered IntegrityError on the
        delete path DB-dependent (SQLAlchemy nulls child FKs before DELETE when
        the children are tracked in the same session). Mocking ``commit`` to raise
        IntegrityError isolates and verifies the handler logic itself.
        """
        comment, _ = self._create_comment(db_session)

        with patch.object(type(db_session), "commit", side_effect=IntegrityError("DELETE", {}, Exception("FK"))):
            response = client.delete(f"/api/admin/comments/{comment.id}", headers=auth_headers)

        assert response.status_code == 400
        assert "dependent records" in response.json()["error"]["message"].lower()

    def test_list_comments_unauthorized(self, client):
        """Test listing comments without auth returns 401."""
        response = client.get("/api/admin/comments")
        assert response.status_code == 401


class TestAdminUserManagement:
    """Tests for admin user CRUD endpoints."""

    def test_create_user(self, client, auth_headers):
        """Test creating a new user."""
        response = client.post(
            "/api/admin/users",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"username": "newuser", "password": "password123"},
        )
        assert response.status_code in [200, 201]
        data = response.json()
        assert data["username"] == "newuser"
        assert data["is_superuser"] is False

    def test_create_user_invalid_username_rejected(self, client, auth_headers):
        """Usernames must match the allowed format (issue #20)."""
        for bad in ["ab", "has space", "含有中文", "bad!@#$"]:
            response = client.post(
                "/api/admin/users",
                headers={**auth_headers, "Content-Type": "application/json"},
                json={"username": bad, "password": "password123"},
            )
            assert response.status_code == 422, f"username {bad!r} should be rejected"

    def test_create_user_already_exists(self, client, auth_headers, db_session):
        """Test creating a user with existing username returns 400."""
        from app.auth import User, get_password_hash

        user = User(username="existing", password=get_password_hash("pass123"), is_superuser=False)
        db_session.add(user)
        db_session.commit()

        response = client.post(
            "/api/admin/users",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"username": "existing", "password": "password123"},
        )
        assert response.status_code == 400

    def test_list_users(self, client, auth_headers, db_session):
        """Test listing all users."""
        users = client.get("/api/admin/users", headers=auth_headers)
        assert users.status_code == 200
        assert isinstance(users.json(), list)

    def test_delete_user(self, client, auth_headers, db_session):
        """Test deleting another user."""
        from app.auth import User, get_password_hash

        user = User(username="to_delete", password=get_password_hash("pass"), is_superuser=False)
        db_session.add(user)
        db_session.commit()
        user_id = user.id

        response = client.delete(f"/api/admin/users/{user_id}", headers=auth_headers)
        assert response.status_code == 200

    def test_delete_user_not_found(self, client, auth_headers):
        """Test deleting a non-existent user returns 404."""
        response = client.delete("/api/admin/users/99999", headers=auth_headers)
        assert response.status_code == 404

    def test_delete_self_user(self, client, auth_headers, admin_user):
        """Test deleting the current user returns 400."""
        response = client.delete(f"/api/admin/users/{admin_user.id}", headers=auth_headers)
        assert response.status_code == 400


class TestAdminIntegrityErrorHandling:
    """Tests for IntegrityError handling on admin write endpoints.

    These test the TOCTOU race condition where two concurrent requests
    pass the duplicate check but the second INSERT hits a unique constraint.
    """

    def test_create_user_duplicate_integrity_error(self, client, auth_headers, db_session):
        """Test creating a user with a duplicate username returns 400, not 500."""
        from app.auth import User, get_password_hash

        existing = User(
            username="duplicate_user",
            password=get_password_hash("pass"),
            is_superuser=False,
        )
        db_session.add(existing)
        db_session.commit()

        response = client.post(
            "/api/admin/users",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"username": "duplicate_user", "password": "password123"},
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["error"]["message"]

    def test_create_category_duplicate_integrity_error(self, client, auth_headers, db_session):
        """Test creating a category with a duplicate name returns 400, not 500."""
        from app import models

        existing = models.Category(name="dup_category")
        db_session.add(existing)
        db_session.commit()

        response = client.post(
            "/api/admin/categories",
            json={"name": "dup_category"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["error"]["message"]

    def test_create_tag_duplicate_integrity_error(self, client, auth_headers, db_session):
        """Test creating a tag with a duplicate name returns 400, not 500."""
        from app import models

        existing = models.Tag(name="dup_tag")
        db_session.add(existing)
        db_session.commit()

        response = client.post(
            "/api/admin/tags",
            json={"name": "dup_tag"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["error"]["message"]

    def test_update_category_duplicate_integrity_error(self, client, auth_headers, db_session):
        """Test updating a category to a duplicate name returns 400, not 500."""
        from app import models

        cat1 = models.Category(name="cat_a")
        cat2 = models.Category(name="cat_b")
        db_session.add_all([cat1, cat2])
        db_session.commit()

        response = client.put(
            f"/api/admin/categories/{cat2.id}",
            json={"name": "cat_a"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["error"]["message"]

    def test_update_tag_duplicate_integrity_error(self, client, auth_headers, db_session):
        """Test updating a tag to a duplicate name returns 400, not 500."""
        from app import models

        tag1 = models.Tag(name="tag_a")
        tag2 = models.Tag(name="tag_b")
        db_session.add_all([tag1, tag2])
        db_session.commit()

        response = client.put(
            f"/api/admin/tags/{tag2.id}",
            json={"name": "tag_a"},
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["error"]["message"]

    def test_update_post_duplicate_slug_integrity_error(self, client, auth_headers, db_session):
        """Test updating a post to a duplicate slug returns 400, not 500."""
        from app import models

        post1 = models.Post(title="Post A", slug="post-a", content="Content", published=True)
        post2 = models.Post(title="Post B", slug="post-b", content="Content", published=True)
        db_session.add_all([post1, post2])
        db_session.commit()

        response = client.put(
            f"/api/admin/posts/{post2.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"slug": "post-a"},
        )
        assert response.status_code == 400
        assert "Slug already exists" in response.json()["error"]["message"]

    def test_admin_get_post_includes_pinned_and_cover_image(self, client, auth_headers, db_session):
        """Test admin post detail includes pinned and cover_image fields."""
        from app import models

        post = models.Post(
            title="Full Detail Post",
            slug="full-detail-post",
            content="Content",
            published=True,
            pinned=True,
            cover_image="https://example.com/cover.jpg",
        )
        db_session.add(post)
        db_session.commit()

        response = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["pinned"] is True
        assert data["cover_image"] == "https://example.com/cover.jpg"

    def test_admin_list_posts_includes_pinned_and_cover_image(self, client, auth_headers, db_session):
        """Test admin post list includes pinned and cover_image fields."""
        from app import models

        post = models.Post(
            title="List Post",
            slug="list-post",
            content="Content",
            published=True,
            pinned=True,
            cover_image="https://example.com/list.jpg",
        )
        db_session.add(post)
        db_session.commit()

        response = client.get("/api/admin/posts", headers=auth_headers)
        assert response.status_code == 200
        posts = response.json()
        post_data = next(p for p in posts["items"] if p["id"] == post.id)
        assert post_data["pinned"] is True
        assert post_data["cover_image"] == "https://example.com/list.jpg"

    def test_admin_update_post_pinned_field(self, client, auth_headers, db_session):
        """Test admin can update the pinned field on a post."""
        from app import models

        post = models.Post(
            title="Pin Test",
            slug="pin-test",
            content="Content",
            published=True,
            pinned=False,
        )
        db_session.add(post)
        db_session.commit()

        response = client.put(
            f"/api/admin/posts/{post.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"pinned": True},
        )
        assert response.status_code == 200

        # Verify the pinned field was updated
        response = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert response.json()["pinned"] is True

    def test_admin_update_post_cover_image_field(self, client, auth_headers, db_session):
        """Test admin can update the cover_image field on a post."""
        from app import models

        post = models.Post(
            title="Cover Test",
            slug="cover-test",
            content="Content",
            published=True,
            cover_image=None,
        )
        db_session.add(post)
        db_session.commit()

        response = client.put(
            f"/api/admin/posts/{post.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"cover_image": "https://example.com/new-cover.jpg"},
        )
        assert response.status_code == 200

        # Verify the cover_image field was updated
        response = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert response.json()["cover_image"] == "https://example.com/new-cover.jpg"

    def test_admin_update_post_clears_cover_image_with_null(self, client, auth_headers, db_session):
        """Admin can clear cover_image by sending null, like the public PUT path.

        Regresses the 'is not None' guard: an explicit null used to be ignored,
        so a cover image could never be removed from the admin UI/API even
        though the public update endpoint supports it.
        """
        from app import models

        post = models.Post(
            title="Clear Cover Test",
            slug="clear-cover-test",
            content="Content",
            published=True,
            cover_image="https://example.com/original.jpg",
        )
        db_session.add(post)
        db_session.commit()

        response = client.put(
            f"/api/admin/posts/{post.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"cover_image": None},
        )
        assert response.status_code == 200

        response = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert response.json()["cover_image"] is None


class TestAdminBatchApprove:
    """Tests for batch comment approval/rejection."""

    def test_batch_approve_comments(self, client, auth_headers, db_session):
        post = models.Post(title="Test", slug="batch-test", content="Content", published=True)
        db_session.add(post)
        db_session.flush()
        c1 = models.Comment(post_id=post.id, nickname="A", content="C1", is_approved=False)
        c2 = models.Comment(post_id=post.id, nickname="B", content="C2", is_approved=False)
        db_session.add_all([c1, c2])
        db_session.commit()

        response = client.post(
            "/api/admin/comments/batch-approve",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"ids": [c1.id, c2.id], "approved": True},
        )
        assert response.status_code == 200
        assert db_session.get(models.Comment, c1.id).is_approved is True
        assert db_session.get(models.Comment, c2.id).is_approved is True

    def test_batch_reject_comments(self, client, auth_headers, db_session):
        post = models.Post(title="Test", slug="batch-reject", content="Content", published=True)
        db_session.add(post)
        db_session.flush()
        c = models.Comment(post_id=post.id, nickname="A", content="C1", is_approved=True)
        db_session.add(c)
        db_session.commit()

        response = client.post(
            "/api/admin/comments/batch-approve",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"ids": [c.id], "approved": False},
        )
        assert response.status_code == 200
        assert db_session.get(models.Comment, c.id).is_approved is False

    def test_batch_approve_too_many_ids_rejected(self, client, auth_headers):
        """More than 100 ids in one batch request is rejected (issue #20)."""
        response = client.post(
            "/api/admin/comments/batch-approve",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"ids": list(range(101)), "approved": True},
        )
        assert response.status_code == 422


class TestAdminPasswordChange:
    """Tests for admin password change."""

    def test_change_password_success(self, client, auth_headers, admin_user, db_session):
        response = client.post(
            "/api/admin/password",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"current_password": "testpass123", "new_password": "newpass456"},
        )
        assert response.status_code == 200
        db_session.refresh(admin_user)
        from app.auth import verify_password

        assert verify_password("newpass456", admin_user.password)

    def test_change_password_wrong_current(self, client, auth_headers):
        response = client.post(
            "/api/admin/password",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"current_password": "wrongpass", "new_password": "newpass456"},
        )
        assert response.status_code == 400
        assert "Current password is incorrect" in response.text

    def test_change_password_invalidates_existing_token(self, client, auth_headers):
        """A JWT issued before a password change must be rejected afterwards.

        Regresses the token_version revocation: without it a stolen token stays
        valid for the full lifetime after the admin rotates their password.
        """
        assert client.get("/api/admin/posts", headers=auth_headers).status_code == 200

        change = client.post(
            "/api/admin/password",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"current_password": "testpass123", "new_password": "newpass456"},
        )
        assert change.status_code == 200

        # The same (old) token must now be rejected — not silently accepted.
        assert client.get("/api/admin/posts", headers=auth_headers).status_code == 401

    def test_new_login_works_after_password_change(self, client, admin_user):
        """After rotating the password, only a fresh login with the new password authenticates."""
        old_token = client.post("/api/admin/login", data={"username": "testadmin", "password": "testpass123"}).json()[
            "access_token"
        ]

        change = client.post(
            "/api/admin/password",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {old_token}"},
            json={"current_password": "testpass123", "new_password": "newpass456"},
        )
        assert change.status_code == 200

        new_login = client.post("/api/admin/login", data={"username": "testadmin", "password": "newpass456"})
        assert new_login.status_code == 200
        assert (
            client.get(
                "/api/admin/posts",
                headers={"Authorization": f"Bearer {new_login.json()['access_token']}"},
            ).status_code
            == 200
        )


class TestAdminPasswordValidation:
    """Tests for password change validation."""

    def test_change_password_requires_min_length(self, client, auth_headers):
        """New passwords shorter than 8 characters are rejected with 422."""
        response = client.post(
            "/api/admin/password",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"current_password": "testpass123", "new_password": "short"},
        )
        assert response.status_code == 422

    def test_change_password_ignores_blank_new_password(self, client, auth_headers):
        """Empty new password is rejected with 422."""
        response = client.post(
            "/api/admin/password",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"current_password": "testpass123", "new_password": ""},
        )
        assert response.status_code == 422


class TestAdminPostCategoryClear:
    """Tests for clearing a post's category via the admin update endpoint."""

    def test_admin_update_post_can_clear_category(self, client, auth_headers, db_session):
        """Explicit category_id: null must unset the category."""
        cat = client.post("/api/admin/categories", json={"name": "To Remove"}, headers=auth_headers).json()
        post = client.post(
            "/api/admin/posts",
            json={
                "title": "Categorized Post",
                "slug": "categorized-post",
                "content": "Body",
                "published": True,
                "category_id": cat["id"],
            },
            headers=auth_headers,
        ).json()

        detail = client.get(f"/api/admin/posts/{post['id']}", headers=auth_headers).json()
        assert detail["category_id"] == cat["id"]

        update = client.put(
            f"/api/admin/posts/{post['id']}",
            json={"category_id": None},
            headers=auth_headers,
        )
        assert update.status_code == 200

        detail = client.get(f"/api/admin/posts/{post['id']}", headers=auth_headers).json()
        assert detail["category_id"] is None


class TestAdminPostStatusFilters:
    """Admin status filters must use naive-UTC publish_at semantics.

    Regresses the tz-aware `datetime.now(UTC)` that was bound against the naive
    `publish_at` column (app/routers/admin.py): behaviorally invisible on
    SQLite/UTC, but wrong on PostgreSQL whenever the session timezone is not
    UTC. The contract is crud.utc_now_naive, the same helper every public
    publish_at guard uses.
    """

    def test_admin_list_posts_scheduled_includes_future_publish_at(self, client, auth_headers, db_session):
        from datetime import timedelta

        from app.crud import utc_now_naive

        now_naive = utc_now_naive()
        scheduled = models.Post(
            title="Future",
            slug="future-post",
            content="C",
            published=True,
            publish_at=now_naive + timedelta(days=1),
        )
        live = models.Post(title="Live", slug="live-post", content="C", published=True)
        db_session.add_all([scheduled, live])
        db_session.commit()

        scheduled_titles = [
            p["title"] for p in client.get("/api/admin/posts?status=scheduled", headers=auth_headers).json()["items"]
        ]
        assert scheduled_titles == ["Future"]

        published_titles = [
            p["title"] for p in client.get("/api/admin/posts?status=published", headers=auth_headers).json()["items"]
        ]
        assert "Future" not in published_titles
        assert "Live" in published_titles

    def test_admin_list_posts_published_includes_boundary_exact_now(self, client, auth_headers, db_session):
        from app.crud import utc_now_naive

        now_naive = utc_now_naive()
        boundary = models.Post(
            title="Boundary",
            slug="boundary-post",
            content="C",
            published=True,
            publish_at=now_naive,
        )
        db_session.add(boundary)
        db_session.commit()

        published_titles = [
            p["title"] for p in client.get("/api/admin/posts?status=published", headers=auth_headers).json()["items"]
        ]
        assert "Boundary" in published_titles
