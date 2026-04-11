from datetime import datetime

from pydantic import BaseModel, ConfigDict


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
    slug: str
    content: str
    excerpt: str | None = None
    published: bool = False
    category_id: int | None = None


class PostCreate(PostBase):
    tags: list[str] = []


class PostUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    content: str | None = None
    excerpt: str | None = None
    published: bool | None = None
    category_id: int | None = None
    tags: list[str] | None = None


class Post(PostBase):
    id: int
    created_at: datetime
    updated_at: datetime
    category: Category | None = None
    tags: list[Tag] = []
    model_config = ConfigDict(from_attributes=True)


class PostList(BaseModel):
    id: int
    title: str
    slug: str
    excerpt: str | None
    published: bool
    created_at: datetime
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
    pass


class Comment(CommentBase):
    id: int
    post_id: int
    ip_address: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
