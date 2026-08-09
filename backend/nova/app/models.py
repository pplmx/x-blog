"""SQLAlchemy ORM models, typed in the SQLAlchemy 2.0 style.

Models use ``Mapped[...] = mapped_column(...)`` so class attribute access on
*instances* carries the true Python type (``post.published`` is ``bool | None``,
not ``Column[bool]``). This makes static type checking (pyright) meaningful.

Nullability intentionally mirrors the legacy schema 1:1: columns that were
declared without ``nullable=False`` stay Optional even where the app always
provides a value (e.g. ``published``, ``views``, timestamps). Tightening those
constraints is a separate, deliberate schema migration, not this refactor.
"""

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", Integer, ForeignKey("posts.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True),
)


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt: Mapped[str | None] = mapped_column(String(500))
    published: Mapped[bool | None] = mapped_column(Boolean, default=False, index=True)
    pinned: Mapped[bool | None] = mapped_column(Boolean, default=False)
    publish_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        index=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), index=True)
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    views: Mapped[int | None] = mapped_column(Integer, default=0, index=True)
    likes: Mapped[int | None] = mapped_column(Integer, default=0)

    category: Mapped[Category | None] = relationship("Category", back_populates="posts")
    tags: Mapped[list[Tag]] = relationship("Tag", secondary=post_tags, back_populates="posts")
    comments: Mapped[list[Comment]] = relationship(
        "Comment",
        back_populates="post",
        cascade="all, delete-orphan",
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)

    posts: Mapped[list[Post]] = relationship("Post", back_populates="category")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)

    posts: Mapped[list[Post]] = relationship("Post", secondary=post_tags, back_populates="tags")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id"), nullable=False, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("comments.id"), nullable=True)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    email: Mapped[str | None] = mapped_column(String(100))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(50))
    is_approved: Mapped[bool | None] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    post: Mapped[Post] = relationship("Post", back_populates="comments")
    parent: Mapped[Comment | None] = relationship("Comment", remote_side=[id], backref="replies")
