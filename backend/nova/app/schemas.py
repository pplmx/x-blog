import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# Slug pattern: lowercase alphanumerics joined by single hyphens. Free-form
# slugs with spaces/&/CJK produce broken RSS/Atom/sitemap URLs and can never
# be matched by the public /posts/{slug_or_id} route.
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class TagBase(BaseModel):
    name: str


class TagCreate(TagBase):
    pass


class Tag(TagBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class CategoryBase(BaseModel):
    name: str


class CategoryCreate(CategoryBase):
    pass


class Category(CategoryBase):
    id: int
    model_config = ConfigDict(from_attributes=True)


class PostBase(BaseModel):
    title: str
    slug: str = Field(pattern=SLUG_PATTERN.pattern)
    content: str
    excerpt: str | None = None
    published: bool = False
    pinned: bool = False
    publish_at: datetime | None = None
    category_id: int | None = None
    cover_image: str | None = None


class PostCreate(PostBase):
    tags: list[str] = []


class PostUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    content: str | None = None
    excerpt: str | None = None
    published: bool | None = None
    pinned: bool | None = None
    publish_at: datetime | None = None
    category_id: int | None = None
    cover_image: str | None = None
    tag_ids: list[int] | None = None


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
    nickname: str
    email: str
    content: str


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
