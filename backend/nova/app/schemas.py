import re
from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Slug pattern: lowercase alphanumerics joined by single hyphens. Free-form
# slugs with spaces/&/CJK produce broken RSS/Atom/sitemap URLs and can never
# be matched by the public /posts/{slug_or_id} route.
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

_ALLOWED_COVER_SCHEMES = {"http", "https"}


def _validate_cover_image_url(value: str | None) -> str | None:
    """Reject dangerous cover_image URLs (e.g. javascript:) — issue #20.

    Allowed: empty string/None (clears the field), relative paths (the upload
    endpoint returns /static/uploads/...), and absolute http(s) URLs.
    """
    if value is None:
        return value
    parsed = urlparse(value)
    if parsed.scheme and parsed.scheme not in _ALLOWED_COVER_SCHEMES:
        raise ValueError("cover_image must be an absolute http(s) URL or a /static/... path")
    return value


class TagBase(BaseModel):
    # max_length 50 matches the Tag.name VARCHAR(50) column (issue #20 debt).
    # Without it, over-length input stores fine on SQLite but raises an
    # uncaught DataError -> 500 on PostgreSQL.
    name: str = Field(max_length=50)


class TagCreate(TagBase):
    pass


class Tag(TagBase):
    id: int
    post_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class CategoryBase(BaseModel):
    # max_length 50 matches the Category.name VARCHAR(50) column.
    name: str = Field(max_length=50)


class CategoryCreate(CategoryBase):
    pass


class Category(CategoryBase):
    id: int
    post_count: int = 0
    model_config = ConfigDict(from_attributes=True)


class PostBase(BaseModel):
    # max_length values match the Post VARCHAR columns (title/slug 200,
    # excerpt/cover_image 500) so PostgreSQL rejects over-length input with
    # 422 instead of an uncaught DataError -> 500.
    title: str = Field(max_length=200)
    slug: str = Field(max_length=200, pattern=SLUG_PATTERN.pattern)
    content: str
    excerpt: str | None = Field(default=None, max_length=500)
    published: bool = False
    pinned: bool = False
    publish_at: datetime | None = None
    category_id: int | None = None
    cover_image: str | None = Field(default=None, max_length=500)


class PostCreate(PostBase):
    tags: list[str] = []

    @field_validator("cover_image")
    @classmethod
    def check_cover_image_scheme(cls, value: str | None) -> str | None:
        return _validate_cover_image_url(value)


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    # Same pattern as PostBase.slug so updates can't introduce broken
    # feed/sitemap URLs (issue debt #7). None = "don't update the field".
    slug: str | None = Field(default=None, max_length=200, pattern=SLUG_PATTERN.pattern)
    content: str | None = None
    excerpt: str | None = Field(default=None, max_length=500)
    published: bool | None = None
    pinned: bool | None = None
    publish_at: datetime | None = None
    category_id: int | None = None
    cover_image: str | None = Field(default=None, max_length=500)
    tag_ids: list[int] | None = None

    @field_validator("cover_image")
    @classmethod
    def check_cover_image_scheme(cls, value: str | None) -> str | None:
        return _validate_cover_image_url(value)


class Post(PostBase):
    id: int
    created_at: datetime
    updated_at: datetime
    views: int = 0
    likes: int = 0
    category: Category | None = None
    tags: list[Tag] = []
    model_config = ConfigDict(from_attributes=True)


class PostList(BaseModel):
    id: int
    title: str
    slug: str
    excerpt: str | None
    snippet: str | None = None
    published: bool
    pinned: bool = False
    created_at: datetime
    views: int = 0
    likes: int = 0
    comment_count: int = 0
    cover_image: str | None = None
    category: Category | None = None
    tags: list[Tag] = []
    model_config = ConfigDict(from_attributes=True)


class PaginationMeta(BaseModel):
    total: int
    page: int
    limit: int
    total_pages: int


class PostListResponse(BaseModel):
    items: list[PostList]
    pagination: PaginationMeta


class CommentBase(BaseModel):
    # max_length values match the Comment VARCHAR columns (nickname 50,
    # email 100) so over-length input is rejected with 422 instead of an
    # uncaught DataError -> 500 on PostgreSQL.
    nickname: str = Field(max_length=50)
    email: str = Field(max_length=100)
    # Bounded so the public, unauthenticated comment endpoint cannot bloat the DB
    # / response with unbounded bodies (security audit round 16).
    content: str = Field(max_length=5000)


class CommentCreate(CommentBase):
    parent_id: int | None = None


class Comment(CommentBase):
    id: int
    post_id: int
    parent_id: int | None = None
    ip_address: str
    is_approved: bool = True
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
