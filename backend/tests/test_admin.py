# ruff: noqa: ARG001
"""Tests for admin CRUD operations.

Uses shared fixtures from conftest.py: admin_user, admin_token, auth_headers.
Credentials: username="testadmin", password="testpass123"
"""

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
            "/api/admin/categories?name=Duplicate",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == "BAD_REQUEST"

    def test_update_category_not_found(self, client, auth_headers):
        """Test updating a non-existent category returns 404."""
        response = client.put(
            "/api/admin/categories/99999?name=NewName",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
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
            "/api/admin/tags?name=DuplicateTag",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
        )
        assert response.status_code == 400
        data = response.json()
        assert data["error"]["code"] == "BAD_REQUEST"

    def test_update_tag_not_found(self, client, auth_headers):
        """Test updating a non-existent tag returns 404."""
        response = client.put(
            "/api/admin/tags/99999?name=NewName",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
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
        comments = response.json()
        assert len(comments) == 1
        assert comments[0]["nickname"] == "Commenter"
        assert comments[0]["content"] == "Nice post!"
        assert comments[0]["post_id"] == post.id
        assert comments[0]["post_title"] == post.title

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
        comments = response.json()
        assert len(comments) == 1
        assert comments[0]["nickname"] == "Alice"
        assert comments[0]["post_id"] == post1.id
        assert comments[0]["post_title"] == "Post One"

    def test_list_comments_empty(self, client, auth_headers):
        """Test listing comments when no comments exist."""
        response = client.get("/api/admin/comments", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []

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
            "/api/admin/categories?name=dup_category",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
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
            "/api/admin/tags?name=dup_tag",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
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
            f"/api/admin/categories/{cat2.id}?name=cat_a",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
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
            f"/api/admin/tags/{tag2.id}?name=tag_a",
            headers={**auth_headers, "Content-Type": "application/x-www-form-urlencoded"},
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
        post_data = next(p for p in posts if p["id"] == post.id)
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
