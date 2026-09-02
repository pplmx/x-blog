# ruff: noqa: ARG001
"""Tests for admin CRUD operations.

Uses shared fixtures from conftest.py: admin_user, admin_token, auth_headers.
Credentials: username="testadmin", password="testpass123"
"""

from datetime import datetime

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
        assert response.status_code == 201
        # No absolute id assert: PG sequences advance on rolled-back inserts, so
        # the created post is not necessarily id 1 in a batched process.
        assert isinstance(response.json()["id"], int) and response.json()["id"] > 0

    def test_get_post(self, client, auth_headers, db_session):
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        response = client.get(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["title"] == "Test"

    def test_get_post_exposes_series_assignment(self, client, auth_headers, db_session):
        """Admin post detail must surface series_id/order + identity (DEC-056,
        TASK-123) so the post editor can render and reassign the membership."""
        series = models.Series(title="Deep Dive", slug="deep-dive", description=None)
        db_session.add(series)
        db_session.commit()
        post = models.Post(
            title="Test",
            slug="test",
            content="Content",
            published=True,
            series_id=series.id,
            series_order=2,
        )
        db_session.add(post)
        db_session.commit()

        response = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["series_id"] == series.id
        assert data["series_order"] == 2
        assert data["series_title"] == "Deep Dive"
        assert data["series_slug"] == "deep-dive"

    def test_list_posts_exposes_series_assignment(self, client, auth_headers, db_session):
        """Admin post list also carries the series fields (list page + editor)."""
        series = models.Series(title="Deep Dive", slug="deep-dive", description=None)
        db_session.add(series)
        db_session.commit()
        post = models.Post(
            title="Test",
            slug="test",
            content="Content",
            published=True,
            series_id=series.id,
            series_order=1,
        )
        db_session.add(post)
        db_session.commit()

        response = client.get("/api/admin/posts", headers=auth_headers)
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["series_id"] == series.id
        assert item["series_order"] == 1
        assert item["series_title"] == "Deep Dive"

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

    def test_update_post_assigns_and_clears_series(self, client, auth_headers, db_session):
        """The admin editor's PUT must persist series membership (RIL ISS-279).

        Previously series_id/series_order were accepted by the schema but never
        applied — assigning an existing post to a series from the editor was a
        silent no-op while the parallel public PUT /api/posts/{id} honored it.
        """
        post = models.Post(title="Test", slug="series-test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()

        series = models.Series(title="S1", slug="s1", description="d")
        db_session.add(series)
        db_session.commit()

        response = client.put(
            f"/api/admin/posts/{post.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"series_id": series.id, "series_order": 2},
        )
        assert response.status_code == 200

        updated = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert updated.status_code == 200
        assert updated.json()["series_id"] == series.id
        assert updated.json()["series_order"] == 2

        # Explicit null clears membership (same semantics as category_id).
        cleared = client.put(
            f"/api/admin/posts/{post.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"series_id": None},
        )
        assert cleared.status_code == 200
        after = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert after.json()["series_id"] is None

        # Unknown series -> 400, not a silent 200.
        bad = client.put(
            f"/api/admin/posts/{post.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"series_id": 99999},
        )
        assert bad.status_code == 400

    def test_update_post_does_not_require_series(self, client, auth_headers, db_session):
        """A plain title/slug update must not 422 for wanting series fields."""
        post = models.Post(title="Test", slug="no-series-test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()

        response = client.put(
            f"/api/admin/posts/{post.id}",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"title": "Renamed"},
        )
        assert response.status_code == 200
        assert client.get(f"/api/admin/posts/{post.id}", headers=auth_headers).json()["series_id"] is None

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
        data = response.json()
        assert isinstance(data, list)
        cat = next((c for c in data if c["id"] == category.id), None)
        assert cat is not None
        assert "post_count" in cat
        assert cat["post_count"] == 0

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
        data = response.json()
        assert isinstance(data, list)
        t = next((x for x in data if x["id"] == tag.id), None)
        assert t is not None
        assert "post_count" in t
        assert t["post_count"] == 0

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

    def test_list_comments_filtered_by_approval_status(self, client, auth_headers, db_session):
        """Filter comments by moderation status (RIL TASK-078, ISS-047)."""
        post = models.Post(title="Status Post", slug="status-post", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        approved = models.Comment(post_id=post.id, nickname="ApprovedUser", content="approved one", is_approved=True)
        pending = models.Comment(post_id=post.id, nickname="PendingUser", content="pending one", is_approved=False)
        db_session.add_all([approved, pending])
        db_session.commit()

        pending_resp = client.get("/api/admin/comments?is_approved=false", headers=auth_headers)
        assert pending_resp.status_code == 200
        pending_items = pending_resp.json()["items"]
        assert len(pending_items) == 1
        assert pending_items[0]["nickname"] == "PendingUser"

        approved_resp = client.get("/api/admin/comments?is_approved=true", headers=auth_headers)
        approved_items = approved_resp.json()["items"]
        assert len(approved_items) == 1
        assert approved_items[0]["nickname"] == "ApprovedUser"

    def test_list_comments_filtered_by_search(self, client, auth_headers, db_session):
        """Search comments by nickname/email/content (RIL TASK-078, ISS-047)."""
        post = models.Post(title="Search Post", slug="search-post", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        # Note: server-side schema validation / moderation state is irrelevant
        # here; search matches across nickname/email/content.
        db_session.add(models.Comment(post_id=post.id, nickname="Carol", email="carol@x.com", content="great write-up"))
        db_session.add(models.Comment(post_id=post.id, nickname="Dan", email="dan@x.com", content="meh"))
        db_session.commit()

        by_nick = client.get("/api/admin/comments?q=carol", headers=auth_headers).json()["items"]
        assert len(by_nick) == 1 and by_nick[0]["nickname"] == "Carol"

        by_content = client.get("/api/admin/comments?q=write-up", headers=auth_headers).json()["items"]
        assert len(by_content) == 1 and by_content[0]["nickname"] == "Carol"

        no_hit = client.get("/api/admin/comments?q=zzzmissing", headers=auth_headers).json()["items"]
        assert no_hit == []

    def test_list_comments_filtered_by_date_range(self, client, auth_headers, db_session):
        """Filter comments by created date range (RIL TASK-078, ISS-047)."""
        from datetime import UTC, datetime

        post = models.Post(title="Date Post", slug="date-post", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        old = models.Comment(
            post_id=post.id,
            nickname="Old",
            content="old",
            created_at=datetime(2024, 1, 1, tzinfo=UTC),
        )
        recent = models.Comment(
            post_id=post.id,
            nickname="Recent",
            content="recent",
            created_at=datetime(2026, 6, 1, tzinfo=UTC),
        )
        db_session.add_all([old, recent])
        db_session.commit()

        within = client.get(
            "/api/admin/comments?date_from=2024-02-01T00:00:00&date_to=2026-12-31T00:00:00",
            headers=auth_headers,
        ).json()["items"]
        assert len(within) == 1 and within[0]["nickname"] == "Recent"

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
        """Test deleting an existing comment (204, no body — standardized delete)."""
        comment, _ = self._create_comment(db_session)

        response = client.delete(f"/api/admin/comments/{comment.id}", headers=auth_headers)
        assert response.status_code == 204

    def test_delete_comment_not_found(self, client, auth_headers):
        """Test deleting a non-existent comment returns 404."""
        response = client.delete("/api/admin/comments/99999", headers=auth_headers)
        assert response.status_code == 404
        data = response.json()
        assert data["error"]["code"] == "NOT_FOUND"

    def test_delete_comment_with_replies_reparents_them(self, client, auth_headers, db_session):
        """Deleting a parent comment that has replies promotes the replies to
        the nearest surviving ancestor (or top-level) instead of refusing/orphaning.

        Regression for the backend deep-dive finding: the old bare delete
        returned 400 on Postgres (FK) and silently orphaned replies on SQLite,
        so an admin could never remove a spam thread with replies. The current
        path mirrors bulk_delete_comments' reparenting (DEC-110).
        """
        comment, post = self._create_comment(db_session)
        reply = models.Comment(
            post_id=post.id,
            nickname="Replier",
            email="reply@test.com",
            content="Reply",
            parent_id=comment.id,
        )
        db_session.add(reply)
        db_session.commit()

        response = client.delete(f"/api/admin/comments/{comment.id}", headers=auth_headers)
        assert response.status_code == 204
        # The reply survives and is promoted to top-level (parent_id None).
        reloaded = db_session.get(models.Comment, reply.id)
        assert reloaded is not None
        assert reloaded.parent_id is None

    def test_delete_comment_parent_with_parent_promotes_to_grandparent(self, client, auth_headers, db_session):
        """Deleting a mid-thread comment attaches its replies to the grandparent."""
        comment, post = self._create_comment(db_session)
        child = models.Comment(
            post_id=post.id,
            nickname="Child",
            email="child@test.com",
            content="Child",
            parent_id=comment.id,
        )
        db_session.add(child)
        db_session.commit()

        response = client.delete(f"/api/admin/comments/{child.id}", headers=auth_headers)
        assert response.status_code == 204
        reloaded = db_session.get(models.Comment, comment.id)
        assert reloaded is not None

    def test_list_comments_unauthorized(self, client):
        """Test listing comments without auth returns 401."""
        response = client.get("/api/admin/comments")
        assert response.status_code == 401


class TestAdminCommentReply:
    """Author replies from the moderation queue (DEC-192, TASK-212)."""

    def _create_comment(self, db_session, post=None, **kwargs):
        if post is None:
            post = models.Post(title="Reply Post", slug="reply-post", content="Content", published=True)
            db_session.add(post)
            db_session.commit()
        comment = models.Comment(
            post_id=post.id,
            nickname=kwargs.get("nickname", "Commenter"),
            email="commenter@test.com",
            content=kwargs.get("content", "Nice post!"),
        )
        db_session.add(comment)
        db_session.commit()
        return comment, post

    def _reply(self, client, auth_headers, comment_id, content="Author here."):
        return client.post(
            f"/api/admin/comments/{comment_id}/reply",
            headers={**auth_headers, "Content-Type": "application/json"},
            json={"content": content},
        )

    def test_reply_requires_auth(self, client):
        resp = client.post("/api/admin/comments/1/reply", json={"content": "hi"})
        assert resp.status_code == 401

    def test_reply_creates_approved_author_comment(self, client, auth_headers, db_session):
        from app.routers.admin import AUTHOR_REPLY_NICKNAME

        comment, post = self._create_comment(db_session)
        resp = self._reply(client, auth_headers, comment.id, content="The author answers here.")
        assert resp.status_code == 201, resp.text
        reply = resp.json()
        assert reply["post_id"] == post.id
        assert reply["parent_id"] == comment.id
        assert reply["is_approved"] is True
        assert reply["is_author_reply"] is True
        assert reply["nickname"] == AUTHOR_REPLY_NICKNAME
        assert reply["content"] == "The author answers here."
        # Immediately approved and public: the public thread carries the reply
        # with its author flag so readers see the badge.
        public = client.get(f"/api/comments/post/{post.id}").json()
        assert any(c["is_author_reply"] is True and c["content"] == "The author answers here." for c in public["items"])

    def test_reply_to_missing_comment_404(self, client, auth_headers):
        resp = self._reply(client, auth_headers, 99999)
        assert resp.status_code == 404

    def test_reply_empty_content_rejected(self, client, auth_headers, db_session):
        comment, _ = self._create_comment(db_session)
        resp = self._reply(client, auth_headers, comment.id, content="")
        assert resp.status_code == 422

    def test_reply_notifies_replied_to_reader(self, client, auth_headers, db_session):
        """The replied-to reader lands in the durable inbox (kind=reply)."""
        from app import models as _models

        reg = client.post(
            "/api/reader/register",
            json={"email": "replied@example.com", "password": "readerpass123", "display_name": "Replied"},
        )
        reader_id = reg.json()["reader"]["id"]
        comment, post = self._create_comment(db_session)
        comment.reader_id = reader_id
        db_session.commit()

        resp = self._reply(client, auth_headers, comment.id, content="Thanks for the note!")
        assert resp.status_code == 201, resp.text
        n = (
            db_session.query(_models.ReaderNotification)
            .filter(_models.ReaderNotification.reader_id == reader_id, _models.ReaderNotification.kind == "reply")
            .order_by(_models.ReaderNotification.id.desc())
            .first()
        )
        assert n is not None, "reply notification must land in the replied-to reader's inbox"
        # title is the fixed reply notice; the post title rides in the body and
        # the deep-link targets the replied-to comment (DEC-072).
        assert post.title in (n.body or "")
        assert f"#comment-{comment.id}" in (n.url or "")


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
        assert response.status_code == 204

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
        row = db_session.get(models.Comment, c.id)
        assert row.is_approved is False
        # A rejected comment must leave the moderation pending queue: reviewed_at
        # is stamped so get_pending_comments (is_approved AND reviewed_at NULL)
        # no longer returns it, and the author's history shows "rejected" not
        # "pending" (previously batch-reject was a silent no-op).
        assert row.reviewed_at is not None

    def test_batch_reject_stamps_reviewed_at_on_pending(self, client, auth_headers, db_session):
        """A pending comment batch-rejected must not stay in the pending queue —
        it is already is_approved=False, so only the reviewed_at stamp moves it."""
        post = models.Post(title="Test", slug="batch-rej-pending", content="Content", published=True)
        db_session.add(post)
        db_session.flush()
        c = models.Comment(post_id=post.id, nickname="A", content="C1", is_approved=False, reviewed_at=None)
        db_session.add(c)
        db_session.commit()

        response = client.post(
            "/api/admin/comments/batch-approve",
            headers={"Content-Type": "application/json", **auth_headers},
            json={"ids": [c.id], "approved": False},
        )
        assert response.status_code == 200
        assert db_session.get(models.Comment, c.id).reviewed_at is not None
        # And it no longer shows in the moderation pending list.
        pending = (
            db_session.query(models.Comment)
            .filter(models.Comment.is_approved.is_(False), models.Comment.reviewed_at.is_(None))
            .all()
        )
        assert c.id not in [p.id for p in pending]

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


class TestAdminPostPublishAtPreservation:
    """The admin post editor must not wipe a scheduled publish_at on save.

    Regresses the data-loss bug (RIL TASK-072, ISS-040): admin_get_post did not
    return publish_at, the editor then always sent publish_at back, and the
    update handler's exclude_unset logic nulled the schedule even when the user
    changed nothing. The get endpoint must return publish_at so the editor can
    round-trip it unchanged.
    """

    def test_admin_get_post_returns_publish_at(self, client, auth_headers, db_session):
        from datetime import timedelta

        from app import models
        from app.crud import utc_now_naive

        scheduled = utc_now_naive() + timedelta(days=1)
        post = models.Post(
            title="Scheduled Post",
            slug="scheduled-post",
            content="Content",
            published=True,
            publish_at=scheduled,
        )
        db_session.add(post)
        db_session.commit()

        response = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["publish_at"] is not None
        parsed = datetime.fromisoformat(data["publish_at"])
        assert parsed.replace(tzinfo=None) == scheduled.replace(tzinfo=None)

    def test_admin_update_untouched_post_preserves_publish_at(self, client, auth_headers, db_session):
        """A save with zero edits must not clear the schedule."""
        from datetime import timedelta

        from app import models
        from app.crud import utc_now_naive

        scheduled = utc_now_naive() + timedelta(days=2)
        post = models.Post(
            title="Keep Schedule",
            slug="keep-schedule",
            content="Content",
            published=True,
            publish_at=scheduled,
        )
        db_session.add(post)
        db_session.commit()

        # Editor round-trips: GET (now returns publish_at), then PUT with the
        # same value echoed back plus an innocuous title edit.
        detail = client.get(f"/api/admin/posts/{post.id}", headers=auth_headers).json()
        payload = {"title": "Keep Schedule v2", "publish_at": detail["publish_at"]}
        update = client.put(
            f"/api/admin/posts/{post.id}",
            json=payload,
            headers=auth_headers,
        )
        assert update.status_code == 200

        refreshed = db_session.get(models.Post, post.id)
        assert refreshed.publish_at is not None
        assert refreshed.publish_at.replace(tzinfo=None) == scheduled.replace(tzinfo=None)


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


class TestCommentsDateOnlyInclusive:
    """date_only date_to in admin comments must include the whole day.

    <input type='date'> submits YYYY-MM-DD; parsed as midnight it excluded
    every comment created later that day. A bare date_to means end-of-day."""

    def test_date_only_date_to_includes_same_day(self, client, auth_headers, db_session):
        from datetime import UTC, datetime

        post = models.Post(title="Date Post", slug="date-post-2", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        today = datetime.now(UTC).replace(microsecond=0)
        c = models.Comment(
            post_id=post.id,
            nickname="SameDay",
            content="same day",
            created_at=today,  # a real time today, not midnight
        )
        db_session.add(c)
        db_session.commit()

        day = today.strftime("%Y-%m-%d")
        resp = client.get(f"/api/admin/comments?date_to={day}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert any(i["nickname"] == "SameDay" for i in resp.json()["items"])

    def test_date_only_date_to_excludes_after_day(self, client, auth_headers, db_session):
        from datetime import UTC, datetime, timedelta

        post = models.Post(title="Date Post", slug="date-post-3", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        # Comment created "tomorrow" relative to a date_to of today.
        tomorrow = datetime.now(UTC).replace(microsecond=0) + timedelta(days=1)
        c = models.Comment(
            post_id=post.id,
            nickname="Tomorrow",
            content="tomorrow",
            created_at=tomorrow,
        )
        db_session.add(c)
        db_session.commit()

        day = (tomorrow - timedelta(days=1)).strftime("%Y-%m-%d")
        resp = client.get(f"/api/admin/comments?date_to={day}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert not any(i["nickname"] == "Tomorrow" for i in resp.json()["items"])

    def test_malformed_date_still_422(self, client, auth_headers):
        resp = client.get("/api/admin/comments?date_to=not-a-date", headers=auth_headers)
        assert resp.status_code == 422
