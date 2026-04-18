"""Tests for Pydantic schemas."""

from datetime import datetime

import pytest
from pydantic import ValidationError

from app import schemas


class TestTagSchemas:
    """Tests for Tag schemas."""

    def test_tag_create_valid(self):
        """Test creating TagCreate with valid data."""
        tag = schemas.TagCreate(name="python")
        assert tag.name == "python"

    def test_tag_create_empty_name(self):
        """Test TagCreate with empty string (Pydantic allows empty strings by default)."""
        # Note: Base Pydantic str field allows empty strings unless explicitly constrained
        tag = schemas.TagCreate(name="")
        assert tag.name == ""

    def test_tag_response_valid(self):
        """Test Tag response schema with ORM object."""
        class MockTag:
            id = 1
            name = "fastapi"

        tag = schemas.Tag.model_validate(MockTag())
        assert tag.id == 1
        assert tag.name == "fastapi"


class TestCategorySchemas:
    """Tests for Category schemas."""

    def test_category_create_valid(self):
        """Test creating CategoryCreate with valid data."""
        category = schemas.CategoryCreate(name="Technology")
        assert category.name == "Technology"

    def test_category_create_empty_name(self):
        """Test CategoryCreate with empty string (Pydantic allows empty strings by default)."""
        # Note: Base Pydantic str field allows empty strings unless explicitly constrained
        category = schemas.CategoryCreate(name="")
        assert category.name == ""

    def test_category_response_valid(self):
        """Test Category response schema with ORM object."""
        class MockCategory:
            id = 1
            name = "Programming"

        category = schemas.Category.model_validate(MockCategory())
        assert category.id == 1
        assert category.name == "Programming"


class TestPostBaseSchemas:
    """Tests for PostBase schema."""

    def test_post_base_required_fields(self):
        """Test PostBase requires title, slug, content."""
        # All required fields provided
        post = schemas.PostBase(
            title="Test Post",
            slug="test-post",
            content="This is test content.",
        )
        assert post.title == "Test Post"
        assert post.slug == "test-post"
        assert post.content == "This is test content."

    def test_post_base_default_values(self):
        """Test PostBase has correct default values."""
        post = schemas.PostBase(
            title="Test",
            slug="test",
            content="Content",
        )
        assert post.excerpt is None
        assert post.published is False
        assert post.pinned is False
        assert post.category_id is None
        assert post.cover_image is None

    def test_post_base_all_optional_fields(self):
        """Test PostBase with all fields provided."""
        post = schemas.PostBase(
            title="Full Post",
            slug="full-post",
            content="Full content here.",
            excerpt="Short excerpt",
            published=True,
            pinned=True,
            category_id=5,
            cover_image="https://example.com/image.jpg",
        )
        assert post.excerpt == "Short excerpt"
        assert post.published is True
        assert post.pinned is True
        assert post.category_id == 5
        assert post.cover_image == "https://example.com/image.jpg"


class TestPostCreateSchema:
    """Tests for PostCreate schema."""

    def test_post_create_valid(self):
        """Test creating PostCreate with valid data."""
        post = schemas.PostCreate(
            title="New Post",
            slug="new-post",
            content="Post content",
            tags=["python", "fastapi"],
        )
        assert post.title == "New Post"
        assert post.tags == ["python", "fastapi"]

    def test_post_create_default_tags(self):
        """Test PostCreate has empty list as default tags."""
        post = schemas.PostCreate(
            title="Post",
            slug="post",
            content="Content",
        )
        assert post.tags == []

    def test_post_create_with_optional_fields(self):
        """Test PostCreate with all optional fields."""
        post = schemas.PostCreate(
            title="Complete Post",
            slug="complete-post",
            content="Complete content",
            excerpt="A brief summary",
            published=True,
            pinned=True,
            category_id=1,
            cover_image="https://example.com/cover.jpg",
            tags=["tech", "tutorial"],
        )
        assert post.published is True
        assert post.pinned is True
        assert post.category_id == 1
        assert len(post.tags) == 2


class TestPostUpdateSchema:
    """Tests for PostUpdate schema."""

    def test_post_update_all_optional(self):
        """Test PostUpdate all fields are optional."""
        post = schemas.PostUpdate()
        assert post.title is None
        assert post.slug is None
        assert post.content is None
        assert post.excerpt is None
        assert post.published is None
        assert post.pinned is None
        assert post.category_id is None
        assert post.tag_ids is None

    def test_post_update_partial_update(self):
        """Test PostUpdate with partial data."""
        post = schemas.PostUpdate(title="Updated Title")
        assert post.title == "Updated Title"
        assert post.slug is None

    def test_post_update_multiple_fields(self):
        """Test PostUpdate with multiple fields."""
        post = schemas.PostUpdate(
            title="New Title",
            published=True,
            pinned=False,
        )
        assert post.title == "New Title"
        assert post.published is True
        assert post.pinned is False


class TestPostResponseSchema:
    """Tests for Post response schema."""

    def test_post_response_with_relationships(self):
        """Test Post response schema with category and tags."""
        class MockCategory:
            id = 1
            name = "Tech"

        class MockTag:
            id = 1
            name = "python"

        class MockPost:
            id = 1
            title = "Test Post"
            slug = "test-post"
            content = "Content"
            excerpt = "Excerpt"
            published = True
            pinned = False
            category_id = 1
            cover_image = None
            created_at = datetime(2024, 1, 1, 12, 0, 0)
            updated_at = datetime(2024, 1, 2, 12, 0, 0)
            views = 100
            likes = 10
            category = MockCategory()
            tags = [MockTag()]

        post = schemas.Post.model_validate(MockPost())
        assert post.id == 1
        assert post.title == "Test Post"
        assert post.views == 100
        assert post.likes == 10
        assert post.category.name == "Tech"
        assert len(post.tags) == 1
        assert post.tags[0].name == "python"


class TestPostListSchema:
    """Tests for PostList schema."""

    def test_post_list_minimal(self):
        """Test PostList with minimal data."""
        class MockPost:
            id = 1
            title = "Minimal Post"
            slug = "minimal-post"
            excerpt = None
            published = True
            pinned = False
            created_at = datetime(2024, 1, 1)
            views = 0
            likes = 0
            cover_image = None
            category = None
            tags = []

        post_list = schemas.PostList.model_validate(MockPost())
        assert post_list.id == 1
        assert post_list.title == "Minimal Post"
        assert post_list.tags == []

    def test_post_list_with_relations(self):
        """Test PostList with category and tags."""
        class MockCategory:
            id = 2
            name = "Science"

        class MockTag:
            id = 3
            name = "physics"

        class MockPost:
            id = 2
            title = "Science Post"
            slug = "science-post"
            excerpt = "About science"
            published = True
            pinned = True
            created_at = datetime(2024, 2, 1)
            views = 50
            likes = 5
            cover_image = "https://example.com/science.jpg"
            category = MockCategory()
            tags = [MockTag()]

        post_list = schemas.PostList.model_validate(MockPost())
        assert post_list.pinned is True
        assert post_list.cover_image == "https://example.com/science.jpg"
        assert post_list.category.name == "Science"


class TestPaginationSchemas:
    """Tests for pagination schemas."""

    def test_pagination_meta_valid(self):
        """Test PaginationMeta with valid data."""
        pagination = schemas.PaginationMeta(
            total=100,
            page=2,
            limit=10,
            total_pages=10,
        )
        assert pagination.total == 100
        assert pagination.page == 2
        assert pagination.limit == 10
        assert pagination.total_pages == 10

    def test_pagination_meta_zero_total(self):
        """Test PaginationMeta with zero total."""
        pagination = schemas.PaginationMeta(
            total=0,
            page=1,
            limit=10,
            total_pages=0,
        )
        assert pagination.total == 0
        assert pagination.total_pages == 0


class TestPostListResponseSchema:
    """Tests for PostListResponse schema."""

    def test_post_list_response_empty(self):
        """Test PostListResponse with empty items."""
        response = schemas.PostListResponse(
            items=[],
            pagination=schemas.PaginationMeta(
                total=0,
                page=1,
                limit=10,
                total_pages=0,
            ),
        )
        assert response.items == []
        assert response.pagination.total == 0

    def test_post_list_response_with_items(self):
        """Test PostListResponse with items."""
        class MockPost:
            id = 1
            title = "Test"
            slug = "test"
            excerpt = None
            published = True
            pinned = False
            created_at = datetime(2024, 1, 1)
            views = 0
            likes = 0
            cover_image = None
            category = None
            tags = []

        response = schemas.PostListResponse(
            items=[schemas.PostList.model_validate(MockPost())],
            pagination=schemas.PaginationMeta(
                total=1,
                page=1,
                limit=10,
                total_pages=1,
            ),
        )
        assert len(response.items) == 1
        assert response.pagination.total == 1


class TestCommentSchemas:
    """Tests for Comment schemas."""

    def test_comment_create_required_fields(self):
        """Test CommentCreate requires nickname, email, content."""
        comment = schemas.CommentCreate(
            nickname="John Doe",
            email="john@example.com",
            content="Great post!",
        )
        assert comment.nickname == "John Doe"
        assert comment.email == "john@example.com"
        assert comment.content == "Great post!"

    def test_comment_create_defaults(self):
        """Test CommentCreate has correct default values."""
        comment = schemas.CommentCreate(
            nickname="Jane",
            email="jane@example.com",
            content="Nice!",
        )
        assert comment.parent_id is None
        assert comment.is_approved is True

    def test_comment_create_with_parent(self):
        """Test CommentCreate with parent_id."""
        comment = schemas.CommentCreate(
            nickname="Reply User",
            email="reply@example.com",
            content="This is a reply",
            parent_id=42,
        )
        assert comment.parent_id == 42

    def test_comment_create_not_approved(self):
        """Test CommentCreate with is_approved=False."""
        comment = schemas.CommentCreate(
            nickname="New User",
            email="new@example.com",
            content="Pending comment",
            is_approved=False,
        )
        assert comment.is_approved is False

    def test_comment_response_valid(self):
        """Test Comment response schema with ORM object."""
        class MockComment:
            id = 1
            post_id = 5
            parent_id = None
            nickname = "Test User"
            email = "test@example.com"
            content = "Test content"
            ip_address = "192.168.1.1"
            is_approved = True
            created_at = datetime(2024, 1, 15, 10, 30, 0)

        comment = schemas.Comment.model_validate(MockComment())
        assert comment.id == 1
        assert comment.post_id == 5
        assert comment.ip_address == "192.168.1.1"

    def test_comment_create_missing_required_field(self):
        """Test CommentCreate missing required field raises error."""
        with pytest.raises(ValidationError):
            schemas.CommentCreate(
                nickname="Missing Email",
                content="Content but no email",
            )


class TestSchemaSerialization:
    """Tests for schema serialization/deserialization."""

    def test_post_create_to_dict(self):
        """Test PostCreate serialization to dict."""
        post = schemas.PostCreate(
            title="Serial Test",
            slug="serial-test",
            content="Testing serialization",
            tags=["test"],
        )
        data = post.model_dump()
        assert data["title"] == "Serial Test"
        assert data["tags"] == ["test"]

    def test_post_update_exclude_none(self):
        """Test PostUpdate exclude_unset behavior."""
        update = schemas.PostUpdate(title="Updated")
        data = update.model_dump(exclude_unset=True)
        assert "title" in data
        assert "slug" not in data

    def test_comment_to_json(self):
        """Test Comment serialization to JSON."""
        comment = schemas.CommentCreate(
            nickname="JSON Test",
            email="json@test.com",
            content="Testing JSON",
        )
        json_data = comment.model_dump_json()
        assert "JSON Test" in json_data
        assert "Testing JSON" in json_data


class TestSchemaValidation:
    """Tests for schema validation edge cases."""

    def test_category_name_max_length(self):
        """Test category name validation."""
        # Categories have max 50 chars per model
        category = schemas.CategoryCreate(name="A" * 50)
        assert len(category.name) == 50

    def test_post_title_max_length(self):
        """Test post title length."""
        # Posts have max 200 chars per model
        post = schemas.PostBase(
            title="T" * 200,
            slug="test-slug",
            content="Content",
        )
        assert len(post.title) == 200

    def test_excerpt_optional_max_length(self):
        """Test excerpt can be None or up to 500 chars."""
        # No explicit max length in schema but model has 500
        post = schemas.PostBase(
            title="Test",
            slug="test",
            content="Content",
            excerpt="E" * 500,
        )
        assert len(post.excerpt) == 500

    def test_post_update_with_tag_ids(self):
        """Test PostUpdate uses tag_ids (list of ints)."""
        update = schemas.PostUpdate(
            tag_ids=[1, 2, 3],
            published=True,
        )
        assert update.tag_ids == [1, 2, 3]
        assert update.tag_ids is not None