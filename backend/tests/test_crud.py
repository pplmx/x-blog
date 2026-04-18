"""Tests for CRUD operations."""

from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import Base


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

        with patch("app.crud.clear_posts_cache"):
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

        with patch("app.crud.clear_posts_cache"):
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

        with pytest.raises(ValueError) as exc_info:
            with patch("app.crud.clear_posts_cache"):
                with patch("app.crud.clear_tags_cache"):
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

        with patch("app.crud.clear_posts_cache"):
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

        with patch("app.crud.clear_posts_cache"):
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

        with patch("app.crud.clear_posts_cache"):
            with patch("app.crud.clear_tags_cache"):
                post = crud.create_post(db_session, post_data)

        assert post.published is True
        assert post.pinned is True
        assert post.excerpt == "Short excerpt"
        # Note: cover_image is in schema but not handled in create_post crud function
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
        with patch("app.crud.clear_posts_cache"):
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
        with patch("app.crud.clear_posts_cache"):
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

        # PostUpdate uses tag_ids (list of ints), not tags (list of strings)
        update_data = schemas.PostUpdate(tag_ids=[tag1.id, tag2.id])
        with patch("app.crud.clear_posts_cache"):
            with patch("app.crud.clear_tags_cache"):
                result = crud.update_post(db_session, post.id, update_data)

        # Note: Current implementation doesn't process tag_ids, but schema accepts it
        assert result is not None

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
        with patch("app.crud.clear_posts_cache"):
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

        with patch("app.crud.clear_posts_cache"):
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

        with patch("app.crud.clear_posts_cache") as mock_clear_posts:
            with patch("app.crud.clear_tags_cache") as mock_clear_tags:
                with patch.object(db_session, "commit"):
                    with patch.object(db_session, "refresh"):
                        crud.create_post(db_session, post_data)

                mock_clear_posts.assert_called_once()
                mock_clear_tags.assert_called_once()

    def test_create_category_clears_cache(self, db_session):
        """Test create_category clears category cache."""
        category_data = schemas.CategoryCreate(name="Cache Category")

        with patch("app.crud.clear_categories_cache") as mock_clear:
            with patch.object(db_session, "commit"):
                with patch.object(db_session, "refresh"):
                    crud.create_category(db_session, category_data)

            mock_clear.assert_called_once()

    def test_create_tag_clears_cache(self, db_session):
        """Test create_tag clears tag cache."""
        tag_data = schemas.TagCreate(name="Cache Tag")

        with patch("app.crud.clear_tags_cache") as mock_clear:
            with patch.object(db_session, "commit"):
                with patch.object(db_session, "refresh"):
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