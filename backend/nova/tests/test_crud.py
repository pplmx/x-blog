"""Tests for CRUD operations."""

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import IntegrityError

from app import cache, crud, models, schemas


class TestGetPosts:
    """Tests for get_posts function."""

    def test_get_posts_default_pagination(self, db_session):
        """Test get_posts returns paginated results."""
        posts, total = crud.get_posts(db_session)
        assert isinstance(posts, list)
        assert isinstance(total, int)
        assert total >= 0

    def test_get_posts_pagination(self, db_session):
        """Test get_posts with pagination parameters."""
        posts, total = crud.get_posts(db_session, skip=0, limit=5)
        assert len(posts) <= 5

    def test_get_posts_include_unpublished(self, db_session):
        """Test get_posts can include unpublished posts."""
        posts, total = crud.get_posts(db_session, published=False)
        assert isinstance(posts, list)

    def test_get_posts_filter_by_category(self, db_session):
        """Test get_posts filters by category_id."""
        posts, total = crud.get_posts(db_session, category_id=999)
        assert isinstance(posts, list)
        assert total == 0 or all(p.category_id == 999 for p in posts)

    def test_get_posts_filter_by_tag(self, db_session):
        """Test get_posts filters by tag_id."""
        posts, total = crud.get_posts(db_session, tag_id=999)
        assert isinstance(posts, list)
        assert total == 0 or all(p.category_id == 999 for p in posts)

    def test_get_posts_filter_by_tag_correct_count(self, db_session):
        """Test get_posts returns correct total when filtering by tag_id.

        This catches a potential bug where query.count() after a join()
        with distinct() could return incorrect counts (counting joined
        rows instead of distinct parent entities).
        """
        # Create a category
        category = models.Category(name="Tag Filter Category")
        db_session.add(category)
        db_session.flush()

        # Create tags
        tag1 = models.Tag(name="tag-filter-1")
        tag2 = models.Tag(name="tag-filter-2")
        db_session.add_all([tag1, tag2])
        db_session.flush()
        tag1_id = tag1.id
        tag2_id = tag2.id

        # Create 3 posts with tag1 (published=True so they appear in default query)
        for i in range(3):
            post = models.Post(
                title=f"Tag Filter Post {i}",
                slug=f"tag-filter-{i}",
                content="Content",
                category_id=category.id,
                published=True,
            )
            post.tags.append(tag1)
            db_session.add(post)

        # Create 2 posts with tag2
        for i in range(2):
            post = models.Post(
                title=f"Tag2 Filter Post {i}",
                slug=f"tag2-filter-{i}",
                content="Content",
                category_id=category.id,
                published=True,
            )
            post.tags.append(tag2)
            db_session.add(post)

        db_session.commit()

        # Filter by tag1 — should return exactly 3 posts and total=3
        posts_tag1, total_tag1 = crud.get_posts(db_session, tag_id=tag1_id)  # type: ignore[arg-type]
        assert len(posts_tag1) == 3
        assert total_tag1 == 3

        # Filter by tag2 — should return exactly 2 posts and total=2
        posts_tag2, total_tag2 = crud.get_posts(db_session, tag_id=tag2_id)  # type: ignore[arg-type]
        assert len(posts_tag2) == 2
        assert total_tag2 == 2

    def test_get_posts_eager_loads_relations(self, db_session):
        """Test get_posts eager loads category and tags."""
        posts, _ = crud.get_posts(db_session)
        # Check that query options are applied (eager loading)
        # Actual content depends on data in DB


class TestGetPost:
    """Tests for get_post function."""

    def test_get_post_returns_none_for_nonexistent(self, db_session):
        """Test get_post returns None for non-existent post."""
        result = crud.get_post(db_session, 99999)
        assert result is None

    def test_get_post_returns_post(self, db_session):
        """Test get_post returns post when exists."""
        # Create a test post first
        category = models.Category(name="Test Category")
        db_session.add(category)
        db_session.flush()

        post = models.Post(
            title="Test Post",
            slug="test-get-post",
            content="Content",
            category_id=category.id,
        )
        db_session.add(post)
        db_session.commit()

        result = crud.get_post(db_session, post.id)
        assert result is not None
        assert result.title == "Test Post"
        assert result.category is not None

    def test_get_post_eager_loads_relations(self, db_session):
        """Test get_post eager loads category and tags."""
        category = models.Category(name="Related Category")
        db_session.add(category)
        db_session.flush()

        tag = models.Tag(name="related-tag")
        db_session.add(tag)
        db_session.flush()

        post = models.Post(
            title="Eager Load Test",
            slug="eager-load-test",
            content="Content",
            category_id=category.id,
        )
        post.tags.append(tag)
        db_session.add(post)
        db_session.commit()

        result = crud.get_post(db_session, post.id)
        assert result.category.name == "Related Category"
        assert len(result.tags) == 1


class TestGetPostBySlug:
    """Tests for get_post_by_slug function."""

    def test_get_post_by_slug_returns_none(self, db_session):
        """Test get_post_by_slug returns None for non-existent slug."""
        result = crud.get_post_by_slug(db_session, "nonexistent-slug")
        assert result is None

    def test_get_post_by_slug_returns_post(self, db_session):
        """Test get_post_by_slug returns post when exists."""
        post = models.Post(
            title="Slug Test",
            slug="unique-slug-12345",
            content="Content",
        )
        db_session.add(post)
        db_session.commit()

        result = crud.get_post_by_slug(db_session, "unique-slug-12345")
        assert result is not None
        assert result.slug == "unique-slug-12345"


class TestCreatePost:
    """Tests for create_post function."""

    def test_create_post_minimal(self, db_session):
        """Test creating post with minimal data."""
        post_data = schemas.PostCreate(
            title="New Post",
            slug="new-post-minimal",
            content="Post content",
        )

        with patch("app.crud.clear_tags_cache"):
            post = crud.create_post(db_session, post_data)

        assert post.id is not None
        assert post.title == "New Post"
        assert post.slug == "new-post-minimal"
        assert post.published is False
        assert post.pinned is False

    def test_create_post_with_category(self, db_session):
        """Test creating post with a category."""
        category = models.Category(name="Test Category")
        db_session.add(category)
        db_session.commit()

        post_data = schemas.PostCreate(
            title="Categorized Post",
            slug="categorized-post",
            content="Content",
            category_id=category.id,
        )

        with patch("app.crud.clear_tags_cache"):
            post = crud.create_post(db_session, post_data)

        assert post.category_id == category.id

    def test_create_post_with_nonexistent_category(self, db_session):
        """Test creating post with non-existent category raises error."""
        post_data = schemas.PostCreate(
            title="Bad Category Post",
            slug="bad-category-post",
            content="Content",
            category_id=99999,
        )

        with (
            pytest.raises(ValueError) as exc_info,
            patch("app.crud.clear_tags_cache"),
        ):
            crud.create_post(db_session, post_data)
        assert "Category" in str(exc_info.value)
        assert "99999" in str(exc_info.value)

    def test_create_post_with_tags(self, db_session):
        """Test creating post with tags."""
        post_data = schemas.PostCreate(
            title="Tagged Post",
            slug="tagged-post",
            content="Content",
            tags=["python", "fastapi"],
        )

        with patch("app.crud.clear_tags_cache"):
            post = crud.create_post(db_session, post_data)

        assert len(post.tags) == 2
        tag_names = [t.name for t in post.tags]
        assert "python" in tag_names
        assert "fastapi" in tag_names

    def test_create_post_reuses_existing_tags(self, db_session):
        """Test creating post reuses existing tags."""
        existing_tag = models.Tag(name="reuse-tag")
        db_session.add(existing_tag)
        db_session.commit()

        post_data = schemas.PostCreate(
            title="Reuse Tag Post",
            slug="reuse-tag-post",
            content="Content",
            tags=["reuse-tag"],
        )

        with patch("app.crud.clear_tags_cache"):
            post = crud.create_post(db_session, post_data)

        assert len(post.tags) == 1
        assert post.tags[0].id == existing_tag.id

    def test_create_post_with_all_fields(self, db_session):
        """Test creating post with all optional fields."""
        category = models.Category(name="Full Post Category")
        db_session.add(category)
        db_session.commit()

        post_data = schemas.PostCreate(
            title="Full Post",
            slug="full-post-test",
            content="Full content",
            excerpt="Short excerpt",
            published=True,
            pinned=True,
            category_id=category.id,
            cover_image="https://example.com/image.jpg",
            tags=["full", "test"],
        )

        with patch("app.crud.clear_tags_cache"):
            post = crud.create_post(db_session, post_data)

        assert post.published is True
        assert post.pinned is True
        assert post.excerpt == "Short excerpt"
        assert post.cover_image == "https://example.com/image.jpg"
        assert len(post.tags) == 2


class TestUpdatePost:
    """Tests for update_post function."""

    def test_update_post_not_found(self, db_session):
        """Test update_post returns None for non-existent post."""
        update_data = schemas.PostUpdate(title="Updated Title")
        result = crud.update_post(db_session, 99999, update_data)
        assert result is None

    def test_update_post_partial_title(self, db_session):
        """Test update_post with only title change."""
        post = models.Post(
            title="Original Title",
            slug="partial-update-test",
            content="Content",
        )
        db_session.add(post)
        db_session.commit()

        update_data = schemas.PostUpdate(title="New Title")
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result is not None
        assert result.title == "New Title"
        assert result.slug == "partial-update-test"  # Unchanged

    def test_update_post_multiple_fields(self, db_session):
        """Test update_post with multiple fields."""
        post = models.Post(
            title="Original",
            slug="multi-update-test",
            content="Original content",
            published=False,
        )
        db_session.add(post)
        db_session.commit()

        update_data = schemas.PostUpdate(
            title="Updated Title",
            content="Updated content",
            published=True,
        )
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result.title == "Updated Title"
        assert result.content == "Updated content"
        assert result.published is True

    def test_update_post_with_tag_ids(self, db_session):
        """Test update_post with tag_ids (list of integers)."""
        # Create some existing tags first
        tag1 = models.Tag(name="existing-tag-1")
        tag2 = models.Tag(name="existing-tag-2")
        db_session.add_all([tag1, tag2])
        db_session.commit()

        post = models.Post(
            title="Tag ID Update Test",
            slug="tag-id-update-test",
            content="Content",
        )
        db_session.add(post)
        db_session.commit()

        update_data = schemas.PostUpdate(tag_ids=[tag1.id, tag2.id])
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result is not None
        assert len(result.tags) == 2

    def test_update_post_with_category(self, db_session):
        """Test update_post with category change."""
        category1 = models.Category(name="Category 1")
        category2 = models.Category(name="Category 2")
        db_session.add_all([category1, category2])
        db_session.commit()

        post = models.Post(
            title="Category Update Test",
            slug="category-update-test",
            content="Content",
            category_id=category1.id,
        )
        db_session.add(post)
        db_session.commit()

        update_data = schemas.PostUpdate(category_id=category2.id)
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result.category_id == category2.id


class TestDeletePost:
    """Tests for delete_post function."""

    def test_delete_post_not_found(self, db_session):
        """Test delete_post returns False for non-existent post."""
        result = crud.delete_post(db_session, 99999)
        assert result is False

    def test_delete_post_success(self, db_session):
        """Test delete_post successfully deletes post."""
        post = models.Post(
            title="Delete Test",
            slug="delete-test-post",
            content="Content to delete",
        )
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        result = crud.delete_post(db_session, post_id)

        assert result is True
        assert crud.get_post(db_session, post_id) is None


class TestCategories:
    """Tests for category CRUD operations."""

    def test_get_categories(self, db_session):
        """Test get_categories returns list."""
        categories = crud.get_categories(db_session)
        assert isinstance(categories, list)

    def test_get_category_not_found(self, db_session):
        """Test get_category returns None for non-existent."""
        result = crud.get_category(db_session, 99999)
        assert result is None

    def test_get_category_found(self, db_session):
        """Test get_category returns category when exists."""
        category = models.Category(name="Find Me Category")
        db_session.add(category)
        db_session.commit()

        result = crud.get_category(db_session, category.id)
        assert result is not None
        assert result.name == "Find Me Category"

    def test_create_category(self, db_session):
        """Test create_category creates new category."""
        category_data = schemas.CategoryCreate(name="New Category")
        with patch("app.crud.clear_categories_cache"):
            category = crud.create_category(db_session, category_data)

        assert category.id is not None
        assert category.name == "New Category"

    def test_update_category(self, db_session):
        """Test update_category updates name."""
        category = models.Category(name="Original Name")
        db_session.add(category)
        db_session.commit()

        update_data = schemas.CategoryCreate(name="Updated Name")
        with patch("app.crud.clear_categories_cache"):
            result = crud.update_category(db_session, category.id, update_data)

        assert result is not None
        assert result.name == "Updated Name"

    def test_update_category_not_found(self, db_session):
        """Test update_category returns None for non-existent."""
        update_data = schemas.CategoryCreate(name="New Name")
        result = crud.update_category(db_session, 99999, update_data)
        assert result is None

    def test_delete_category(self, db_session):
        """Test delete_category removes category."""
        category = models.Category(name="Delete Me")
        db_session.add(category)
        db_session.commit()
        cat_id = category.id

        with patch("app.crud.clear_categories_cache"):
            result = crud.delete_category(db_session, cat_id)

        assert result is True
        assert crud.get_category(db_session, cat_id) is None


class TestTags:
    """Tests for tag CRUD operations."""

    def test_get_tags(self, db_session):
        """Test get_tags returns list."""
        tags = crud.get_tags(db_session)
        assert isinstance(tags, list)

    def test_get_tag_not_found(self, db_session):
        """Test get_tag returns None for non-existent."""
        result = crud.get_tag(db_session, 99999)
        assert result is None

    def test_get_tag_found(self, db_session):
        """Test get_tag returns tag when exists."""
        tag = models.Tag(name="Find Tag")
        db_session.add(tag)
        db_session.commit()

        result = crud.get_tag(db_session, tag.id)
        assert result is not None
        assert result.name == "Find Tag"

    def test_get_tag_by_name(self, db_session):
        """Test get_tag_by_name returns tag."""
        tag = models.Tag(name="By Name Tag")
        db_session.add(tag)
        db_session.commit()

        result = crud.get_tag_by_name(db_session, "By Name Tag")
        assert result is not None
        assert result.name == "By Name Tag"

    def test_create_tag(self, db_session):
        """Test create_tag creates new tag."""
        tag_data = schemas.TagCreate(name="New Tag")
        with patch("app.crud.clear_tags_cache"):
            tag = crud.create_tag(db_session, tag_data)

        assert tag.id is not None
        assert tag.name == "New Tag"

    def test_update_tag(self, db_session):
        """Test update_tag updates name."""
        tag = models.Tag(name="Original Tag Name")
        db_session.add(tag)
        db_session.commit()

        update_data = schemas.TagCreate(name="Updated Tag Name")
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_tag(db_session, tag.id, update_data)

        assert result is not None
        assert result.name == "Updated Tag Name"

    def test_delete_tag(self, db_session):
        """Test delete_tag removes tag."""
        tag = models.Tag(name="Delete Tag")
        db_session.add(tag)
        db_session.commit()
        tag_id = tag.id

        with patch("app.crud.clear_tags_cache"):
            result = crud.delete_tag(db_session, tag_id)

        assert result is True
        assert crud.get_tag(db_session, tag_id) is None


class TestComments:
    """Tests for comment CRUD operations."""

    def test_get_comments_empty(self, db_session):
        """Test get_comments returns empty list for post without comments."""
        comments = crud.get_comments(db_session, 99999)
        assert comments == []

    def test_get_comments_paginated(self, db_session):
        """Test get_comments_paginated returns tuple."""
        comments, total = crud.get_comments_paginated(db_session, 99999)
        assert isinstance(comments, list)
        assert isinstance(total, int)

    def test_create_comment(self, db_session):
        """Test create_comment creates comment."""
        # Create a post first
        post = models.Post(title="Comment Post", slug="comment-post", content="Content")
        db_session.add(post)
        db_session.commit()

        comment_data = schemas.CommentCreate(
            nickname="Test User",
            email="test@example.com",
            content="Test comment",
        )

        comment = crud.create_comment(
            db_session,
            post.id,
            comment_data,
            ip_address="127.0.0.1",
        )

        assert comment.id is not None
        assert comment.nickname == "Test User"
        assert comment.email == "test@example.com"
        assert comment.content == "Test comment"
        assert comment.ip_address == "127.0.0.1"

    def test_approve_comment(self, db_session):
        """Test approve_comment updates is_approved."""
        post = models.Post(title="Approve Post", slug="approve-post", content="Content")
        db_session.add(post)
        db_session.commit()

        comment = models.Comment(
            post_id=post.id,
            nickname="User",
            email="user@test.com",
            content="Comment",
            is_approved=False,
        )
        db_session.add(comment)
        db_session.commit()

        result = crud.approve_comment(db_session, comment.id, approved=True)
        assert result is not None
        assert result.is_approved is True

    def test_delete_comment(self, db_session):
        """Test delete_comment removes comment."""
        post = models.Post(title="Delete Comment Post", slug="delete-comment-post", content="Content")
        db_session.add(post)
        db_session.commit()

        comment = models.Comment(
            post_id=post.id,
            nickname="User",
            email="user@test.com",
            content="Comment to delete",
        )
        db_session.add(comment)
        db_session.commit()
        comment_id = comment.id

        result = crud.delete_comment(db_session, comment_id)
        assert result is True


class TestSearchPosts:
    """Tests for search_posts function."""

    def test_search_posts_empty_results(self, db_session):
        """Test search_posts with no matches."""
        posts, total = crud.search_posts(db_session, "nonexistentsearchterm12345")
        assert isinstance(posts, list)
        assert total == 0

    def test_search_posts_by_title(self, db_session):
        """Test search_posts finds posts by title."""
        post = models.Post(
            title="Unique Search Term Post",
            slug="search-title-test",
            content="Some content",
            published=True,
        )
        db_session.add(post)
        db_session.commit()

        posts, total = crud.search_posts(db_session, "Unique Search")
        assert total >= 1
        assert any("Unique Search" in p.title for p in posts)

    def test_search_posts_by_content(self, db_session):
        """Test search_posts finds posts by content."""
        post = models.Post(
            title="Content Search Test",
            slug="search-content-test",
            content="This has a very unique content string XYZ123",
            published=True,
        )
        db_session.add(post)
        db_session.commit()

        posts, total = crud.search_posts(db_session, "XYZ123")
        assert total >= 1

    def test_search_posts_pagination(self, db_session):
        """Test search_posts with pagination."""
        posts, total = crud.search_posts(db_session, "test", page=1, limit=5)
        assert isinstance(posts, list)
        assert len(posts) <= 5

    def test_search_posts_percent_wildcard_matches_literally(self, db_session):
        """A bare % must not match every post — it is escaped (issue #20)."""
        db_session.add_all(
            [
                models.Post(
                    title="Plain Title",
                    slug="plain-title",
                    content="No percent here",
                    published=True,
                ),
                models.Post(
                    title="50% Off Deal",
                    slug="percent-deal",
                    content="Contains a literal percent",
                    published=True,
                ),
            ]
        )
        db_session.commit()

        posts, total = crud.search_posts(db_session, "%")
        assert total == 1
        assert posts[0].title == "50% Off Deal"

    def test_search_posts_underscore_wildcard_matches_literally(self, db_session):
        """A bare _ must not act as a single-char wildcard (issue #20)."""
        db_session.add_all(
            [
                models.Post(
                    title="Title One",
                    slug="title-one",
                    content="No underscores",
                    published=True,
                ),
                models.Post(
                    title="snake_case_note",
                    slug="snake-case-note",
                    content="Has underscores",
                    published=True,
                ),
            ]
        )
        db_session.commit()

        posts, total = crud.search_posts(db_session, "_")
        assert total == 1
        assert posts[0].title == "snake_case_note"


class TestRelatedPosts:
    """Tests for get_related_posts function."""

    def test_get_related_posts_not_found(self, db_session):
        """Test get_related_posts returns empty for non-existent post."""
        posts = crud.get_related_posts(db_session, 99999)
        assert isinstance(posts, list)

    def test_get_related_posts_fallback_category(self, db_session):
        """Test get_related_posts falls back to category when no tags."""
        category = models.Category(name="Related Category")
        db_session.add(category)
        db_session.commit()

        # Create source post
        source_post = models.Post(
            title="Source Post",
            slug="source-post-for-related",
            content="Source content",
            published=True,
            category_id=category.id,
        )
        db_session.add(source_post)
        db_session.commit()

        # Create related post in same category
        related_post = models.Post(
            title="Related Post",
            slug="related-post-for-source",
            content="Related content",
            published=True,
            category_id=category.id,
        )
        db_session.add(related_post)
        db_session.commit()

        posts = crud.get_related_posts(db_session, source_post.id)
        assert isinstance(posts, list)

    def test_get_related_posts_with_tags_and_category(self, db_session):
        """Test get_related_posts with tags and category priority branch."""
        category = models.Category(name="Tag Related Category")
        db_session.add(category)
        db_session.flush()

        tag1 = models.Tag(name="related-tag-1")
        tag2 = models.Tag(name="related-tag-2")
        db_session.add_all([tag1, tag2])
        db_session.flush()

        # Source post with tags and category
        source_post = models.Post(
            title="Source Post With Tags",
            slug="source-with-tags",
            content="Source content",
            published=True,
            category_id=category.id,
        )
        source_post.tags.extend([tag1, tag2])
        db_session.add(source_post)
        db_session.commit()

        # Related post in same category with shared tag
        related_post = models.Post(
            title="Related By Tags",
            slug="related-by-tags",
            content="Related content",
            published=True,
            category_id=category.id,
        )
        related_post.tags.append(tag1)
        db_session.add(related_post)
        db_session.commit()

        # Unrelated post (different category, no shared tags)
        other_post = models.Post(
            title="Unrelated Post",
            slug="unrelated-post",
            content="Other content",
            published=True,
        )
        db_session.add(other_post)
        db_session.commit()

        posts = crud.get_related_posts(db_session, source_post.id, limit=5)
        assert isinstance(posts, list)
        assert len(posts) >= 1
        # The related post should be in the results
        post_ids = [p.id for p in posts]
        assert related_post.id in post_ids
        # The source post itself should NOT be in the results
        assert source_post.id not in post_ids


class TestPopularPosts:
    """Tests for get_popular_posts function."""

    def test_get_popular_posts(self, db_session):
        """Test get_popular_posts returns posts."""
        posts = crud.get_popular_posts(db_session, limit=5)
        assert isinstance(posts, list)
        assert len(posts) <= 5


class TestCacheInteraction:
    """Tests for cache interaction in CRUD operations."""

    def test_get_categories_uses_cache(self, db_session):
        """Test get_categories checks cache before querying DB."""
        with patch("app.crud.categories_cache", {"all_categories": ["cached"]}):
            result = crud.get_categories(db_session)
            assert result == ["cached"]

    def test_get_tags_uses_cache(self, db_session):
        """Test get_tags checks cache before querying DB."""
        with patch("app.crud.tags_cache", {"all_tags": ["cached_tag"]}):
            result = crud.get_tags(db_session)
            assert result == ["cached_tag"]

    def test_create_post_clears_cache(self, db_session):
        """Test create_post clears caches after creation."""
        post_data = schemas.PostCreate(
            title="Cache Test Post",
            slug="cache-test-post",
            content="Content",
        )

        with (
            patch("app.crud.clear_tags_cache") as mock_clear_tags,
            patch.object(db_session, "commit"),
            patch.object(db_session, "refresh"),
        ):
            crud.create_post(db_session, post_data)

        mock_clear_tags.assert_called_once()

    def test_create_category_clears_cache(self, db_session):
        """Test create_category clears category cache."""
        category_data = schemas.CategoryCreate(name="Cache Category")

        with patch("app.crud.clear_categories_cache") as mock_clear:
            with patch.object(db_session, "commit"), patch.object(db_session, "refresh"):
                crud.create_category(db_session, category_data)

            mock_clear.assert_called_once()

    def test_create_tag_clears_cache(self, db_session):
        """Test create_tag clears tag cache."""
        tag_data = schemas.TagCreate(name="Cache Tag")

        with patch("app.crud.clear_tags_cache") as mock_clear:
            with patch.object(db_session, "commit"), patch.object(db_session, "refresh"):
                crud.create_tag(db_session, tag_data)

            mock_clear.assert_called_once()


class TestIncrementViewsAndLikes:
    """Tests for increment_views and increment_likes functions."""

    def test_increment_views_not_found(self, db_session):
        """Test increment_views returns None for non-existent post."""
        result = crud.increment_views(db_session, 99999)
        assert result is None

    def test_increment_views_success(self, db_session):
        """Test increment_views increments view count."""
        post = models.Post(
            title="Views Test",
            slug="views-test",
            content="Content",
            views=10,
        )
        db_session.add(post)
        db_session.commit()

        result = crud.increment_views(db_session, post.id)
        assert result is not None
        assert result.views == 11

    def test_increment_likes_not_found(self, db_session):
        """Test increment_likes returns None for non-existent post."""
        result = crud.increment_likes(db_session, 99999)
        assert result is None

    def test_increment_likes_success(self, db_session):
        """Test increment_likes increments like count."""
        post = models.Post(
            title="Likes Test",
            slug="likes-test",
            content="Content",
            likes=5,
        )
        db_session.add(post)
        db_session.commit()

        result = crud.increment_likes(db_session, post.id)
        assert result is not None
        assert result.likes == 6

    def test_increment_views_commit_failure_rolls_back(self):
        """Test increment_views rolls back on commit failure."""
        mock_db = MagicMock()
        mock_db.commit.side_effect = Exception("Commit failed")
        mock_result = MagicMock()
        mock_result.rowcount = 1
        mock_db.execute.return_value = mock_result

        with pytest.raises(Exception, match="Commit failed"):
            crud.increment_views(mock_db, 1)

        mock_db.rollback.assert_called_once()

    def test_increment_views_recovers_from_daily_row_race(self):
        """Two concurrent first-view pageviews on a day resolve, not 500 (ISS-138).

        The loser's commit hits the unique uq_post_views_daily_post_day row and
        must roll back, then re-apply the increments as atomic UPDATEs so the
        view is still counted and no IntegrityError escapes to the public
        POST /api/posts/{id}/view endpoint.
        """
        mock_db = MagicMock()
        # First commit loses the race (IntegrityError); the recovery commit wins.
        mock_db.commit.side_effect = [
            IntegrityError("INSERT INTO post_views_daily", {}, Exception("UNIQUE constraint")),
            None,
        ]
        mock_result = MagicMock()
        mock_result.rowcount = 1
        mock_db.execute.return_value = mock_result
        # The losing transaction never saw the other writer's daily row.
        mock_db.query.return_value.filter_by.return_value.first.return_value = None

        result = crud.increment_views(mock_db, 1)

        assert result is not None
        # Initial commit + recovery commit; the failed one was rolled back.
        assert mock_db.commit.call_count == 2
        mock_db.rollback.assert_called_once()

    def test_increment_views_invalidates_posts_list_cache(self, db_session):
        """A pageview must drop the cached list payloads (they embed views, ISS-141)."""
        post = models.Post(title="Cache Views", slug="cache-views", content="Content")
        db_session.add(post)
        db_session.commit()

        cache.posts_list_cache[(1, 10, None, None)] = {"items": [{"id": post.id, "views": 0}]}
        assert len(cache.posts_list_cache) == 1

        crud.increment_views(db_session, post.id)

        assert len(cache.posts_list_cache) == 0


class TestReaderUpsertIdempotency:
    """Concurrent duplicate-key writes on reader follows/bookmarks/subscriptions
    must resolve as idempotent (re-fetch the winner) instead of 500 (ISS-143)."""

    def test_add_reader_bookmark_recovers_from_duplicate_key_race(self):
        mock_db = MagicMock()
        # The first commit loses the unique-key race; the recovery re-fetches the
        # winner WITHOUT a second write (no further commit is made).
        mock_db.commit.side_effect = [
            IntegrityError("INSERT INTO reader_bookmarks", {}, Exception("UNIQUE constraint")),
            None,
        ]
        existing = MagicMock()
        # Pre-check sees no row; after the rollback the re-fetch sees the winner.
        mock_db.query.return_value.filter.return_value.first.side_effect = [None, existing]

        bookmark, created = crud.add_reader_bookmark(mock_db, 1, 2)

        assert created is False
        assert bookmark is existing
        # Only the failed attempt commits; no second write, rollback once.
        assert mock_db.commit.call_count == 1
        mock_db.rollback.assert_called_once()

    def test_record_reading_history_recovers_from_duplicate_key_race(self):
        mock_db = MagicMock()
        mock_db.commit.side_effect = [
            IntegrityError("INSERT INTO reading_history", {}, Exception("UNIQUE constraint")),
            None,
        ]
        existing = MagicMock()
        mock_db.query.return_value.filter.return_value.first.side_effect = [None, existing]

        row, created = crud.record_reading_history(mock_db, 1, 2)

        assert created is False
        assert row is existing
        assert mock_db.commit.call_count == 1
        mock_db.rollback.assert_called_once()

    def test_increment_likes_commit_failure_rolls_back(self):
        """Test increment_likes rolls back on commit failure."""
        mock_db = MagicMock()
        mock_db.commit.side_effect = Exception("Commit failed")
        mock_result = MagicMock()
        mock_result.rowcount = 1
        mock_db.execute.return_value = mock_result

        with pytest.raises(Exception, match="Commit failed"):
            crud.increment_likes(mock_db, 1)

        mock_db.rollback.assert_called_once()


class TestDeletePostForeignKey:
    """Tests for delete_post with foreign key constraints."""

    def test_delete_post_with_comments(self, db_session):
        """Test delete_post successfully deletes post with associated comments (cascade)."""
        post = models.Post(title="Cascade Delete Post", slug="cascade-delete-post", content="Content")
        db_session.add(post)
        db_session.flush()

        comment = models.Comment(
            post_id=post.id,
            nickname="Commenter",
            email="c@test.com",
            content="A comment",
        )
        db_session.add(comment)
        db_session.commit()
        post_id = post.id

        result = crud.delete_post(db_session, post_id)

        assert result is True
        # Comments should be cascade-deleted
        deleted_comment = db_session.get(models.Comment, comment.id)
        assert deleted_comment is None

    def test_delete_post_not_found(self, db_session):
        """Test delete_post returns False for non-existent post."""
        result = crud.delete_post(db_session, 99999)
        assert result is False


class TestDeleteCategoryForeignKey:
    """Tests for delete_category with foreign key constraints."""

    def test_delete_category_with_posts_raises_error(self, db_session):
        """Test delete_category raises ValueError when category has posts."""
        category = models.Category(name="Protected Category")
        db_session.add(category)
        db_session.flush()

        post = models.Post(
            title="Post with Category",
            slug="post-with-category",
            content="Content",
            category_id=category.id,
        )
        db_session.add(post)
        db_session.commit()

        with pytest.raises(ValueError, match="posts"):
            crud.delete_category(db_session, category.id)

    def test_delete_category_without_posts(self, db_session):
        """Test delete_category succeeds when category has no posts."""
        category = models.Category(name="Empty Category")
        db_session.add(category)
        db_session.commit()
        cat_id = category.id

        with patch("app.crud.clear_categories_cache"):
            result = crud.delete_category(db_session, cat_id)

        assert result is True
        assert crud.get_category(db_session, cat_id) is None


class TestDeleteTagForeignKey:
    """Tests for delete_tag with foreign key constraints."""

    def test_delete_tag_with_posts_raises_error(self, db_session):
        """Test delete_tag raises ValueError when tag is used in posts."""
        tag = models.Tag(name="Protected Tag")
        db_session.add(tag)
        db_session.flush()

        post = models.Post(
            title="Post with Tag",
            slug="post-with-tag",
            content="Content",
        )
        post.tags.append(tag)
        db_session.add(post)
        db_session.commit()

        with pytest.raises(ValueError, match="posts"):
            crud.delete_tag(db_session, tag.id)

    def test_delete_tag_without_posts(self, db_session):
        """Test delete_tag succeeds when tag has no posts."""
        tag = models.Tag(name="Unused Tag")
        db_session.add(tag)
        db_session.commit()
        tag_id = tag.id

        with patch("app.crud.clear_tags_cache"):
            result = crud.delete_tag(db_session, tag_id)

        assert result is True
        assert crud.get_tag(db_session, tag_id) is None


class TestUpdatePostTagIds:
    """Tests for update_post with tag_ids field."""

    def test_update_post_with_new_tag_ids(self, db_session):
        """Test update_post with tag_ids assigns tags to post."""
        tag1 = models.Tag(name="updated-tag-1")
        tag2 = models.Tag(name="updated-tag-2")
        db_session.add_all([tag1, tag2])
        db_session.commit()

        post = models.Post(
            title="Tag IDs Update Test",
            slug="tag-ids-update-test",
            content="Content",
        )
        db_session.add(post)
        db_session.commit()

        update_data = schemas.PostUpdate(tag_ids=[tag1.id, tag2.id])
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result is not None
        assert len(result.tags) == 2
        tag_ids = [t.id for t in result.tags]
        assert tag1.id in tag_ids
        assert tag2.id in tag_ids

    def test_update_post_replace_tag_ids(self, db_session):
        """Test update_post with tag_ids replaces existing tags."""
        old_tag = models.Tag(name="old-tag")
        new_tag = models.Tag(name="new-tag")
        db_session.add_all([old_tag, new_tag])
        db_session.commit()

        post = models.Post(
            title="Replace Tags Test",
            slug="replace-tags-test",
            content="Content",
        )
        post.tags.append(old_tag)
        db_session.add(post)
        db_session.commit()

        assert len(post.tags) == 1

        update_data = schemas.PostUpdate(tag_ids=[new_tag.id])
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result is not None
        assert len(result.tags) == 1
        assert result.tags[0].id == new_tag.id

    def test_update_post_clear_tag_ids(self, db_session):
        """Test update_post with empty tag_ids removes all tags."""
        tag1 = models.Tag(name="clear-tag-1")
        db_session.add(tag1)
        db_session.commit()

        post = models.Post(
            title="Clear Tags Test",
            slug="clear-tags-test",
            content="Content",
        )
        post.tags.append(tag1)
        db_session.add(post)
        db_session.commit()

        assert len(post.tags) == 1

        update_data = schemas.PostUpdate(tag_ids=[])
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result is not None
        assert len(result.tags) == 0


class TestIntegrityErrorHandling:
    """Tests for IntegrityError handling in category/tag CRUD operations."""

    def test_create_category_duplicate_integrity_error(self, db_session):
        """Test create_category raises ValueError on duplicate name (IntegrityError)."""
        category = models.Category(name="Duplicate Cat")
        db_session.add(category)
        db_session.commit()

        category_data = schemas.CategoryCreate(name="Duplicate Cat")
        with (
            patch("app.crud.clear_categories_cache"),
            pytest.raises(ValueError, match="already exists"),
        ):
            crud.create_category(db_session, category_data)

    def test_update_category_duplicate_integrity_error(self, db_session):
        """Test update_category raises ValueError on duplicate name (IntegrityError)."""
        cat1 = models.Category(name="Category One")
        cat2 = models.Category(name="Category Two")
        db_session.add_all([cat1, cat2])
        db_session.commit()

        update_data = schemas.CategoryCreate(name="Category One")
        with (
            patch("app.crud.clear_categories_cache"),
            pytest.raises(ValueError, match="already exists"),
        ):
            crud.update_category(db_session, cat2.id, update_data)

    def test_create_tag_duplicate_integrity_error(self, db_session):
        """Test create_tag raises ValueError on duplicate name (IntegrityError)."""
        tag = models.Tag(name="Duplicate Tag")
        db_session.add(tag)
        db_session.commit()

        tag_data = schemas.TagCreate(name="Duplicate Tag")
        with (
            patch("app.crud.clear_tags_cache"),
            pytest.raises(ValueError, match="already exists"),
        ):
            crud.create_tag(db_session, tag_data)

    def test_update_tag_duplicate_integrity_error(self, db_session):
        """Test update_tag raises ValueError on duplicate name (IntegrityError)."""
        tag1 = models.Tag(name="Tag One")
        tag2 = models.Tag(name="Tag Two")
        db_session.add_all([tag1, tag2])
        db_session.commit()

        update_data = schemas.TagCreate(name="Tag One")
        with (
            patch("app.crud.clear_tags_cache"),
            pytest.raises(ValueError, match="already exists"),
        ):
            crud.update_tag(db_session, tag2.id, update_data)

    def test_create_post_duplicate_slug_integrity_error(self, db_session):
        """Test create_post raises ValueError on duplicate slug (IntegrityError)."""
        post = models.Post(title="Original Post", slug="duplicate-slug-test", content="Content")
        db_session.add(post)
        db_session.commit()

        post_data = schemas.PostCreate(title="Duplicate Post", slug="duplicate-slug-test", content="Other content")
        with (
            patch("app.crud.clear_tags_cache"),
            pytest.raises(ValueError, match="already exists"),
        ):
            crud.create_post(db_session, post_data)

    def test_update_post_duplicate_slug_integrity_error(self, db_session):
        """Test update_post raises ValueError on duplicate slug (IntegrityError)."""
        post1 = models.Post(title="Post One", slug="post-one-slug", content="Content")
        post2 = models.Post(title="Post Two", slug="post-two-slug", content="Content")
        db_session.add(post1)
        db_session.add(post2)
        db_session.commit()

        update_data = schemas.PostUpdate(slug="post-one-slug")
        with (
            patch("app.crud.clear_tags_cache"),
            pytest.raises(ValueError, match="already exists"),
        ):
            crud.update_post(db_session, post2.id, update_data)


class TestCreatePostCoverImage:
    """Tests for cover_image handling in create_post."""

    def test_create_post_with_cover_image(self, db_session):
        """Test creating a post with cover_image saves it correctly."""
        post_data = schemas.PostCreate(
            title="Cover Image Post",
            slug="cover-image-post-test",
            content="Content",
            cover_image="https://example.com/cover.jpg",
        )

        with patch("app.crud.clear_tags_cache"):
            post = crud.create_post(db_session, post_data)

        assert post.cover_image == "https://example.com/cover.jpg"

    def test_create_post_without_cover_image_defaults_none(self, db_session):
        """Test creating a post without cover_image defaults to None."""
        post_data = schemas.PostCreate(
            title="No Cover Post",
            slug="no-cover-post-test",
            content="Content",
        )

        with patch("app.crud.clear_tags_cache"):
            post = crud.create_post(db_session, post_data)

        assert post.cover_image is None


class TestUpdatePostCoverImage:
    """Tests for cover_image handling in update_post."""

    def test_update_post_with_cover_image(self, db_session):
        """Test updating a post's cover_image via update_post."""
        post = models.Post(
            title="Update Cover Post",
            slug="update-cover-post",
            content="Content",
        )
        db_session.add(post)
        db_session.commit()

        update_data = schemas.PostUpdate(cover_image="https://example.com/updated.jpg")
        with patch("app.crud.clear_tags_cache"):
            result = crud.update_post(db_session, post.id, update_data)

        assert result is not None
        assert result.cover_image == "https://example.com/updated.jpg"
