from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class TagBase(BaseModel):
    name: str


class TagCreate(TagBase):
    pass


class Tag(TagBase):
    id: int

    class Config:
        from_attributes = True


class CategoryBase(BaseModel):
    name: str


class CategoryCreate(CategoryBase):
    pass


class Category(CategoryBase):
    id: int

    class Config:
        from_attributes = True


class PostBase(BaseModel):
    title: str
    slug: str
    content: str
    excerpt: Optional[str] = None
    published: bool = False
    category_id: Optional[int] = None


class PostCreate(PostBase):
    tags: List[str] = []


class PostUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    content: Optional[str] = None
    excerpt: Optional[str] = None
    published: Optional[bool] = None
    category_id: Optional[int] = None
    tags: Optional[List[str]] = None


class Post(PostBase):
    id: int
    created_at: datetime
    updated_at: datetime
    category: Optional[Category] = None
    tags: List[Tag] = []

    class Config:
        from_attributes = True


class PostList(BaseModel):
    id: int
    title: str
    slug: str
    excerpt: Optional[str]
    published: bool
    created_at: datetime
    category: Optional[Category] = None
    tags: List[Tag] = []

    class Config:
        from_attributes = True
