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

    # No DB-level FOREIGN KEY on series_id, by design (DEC-056/TASK-121): the
    # series migration is entirely additive per DEC-009, and SQLite's alembic
    # dialect can't add an FK column to an existing table without batch-mode
    # table recreation. Referential integrity is enforced at the ORM layer
    # (crud validates series on create/update and unlinks posts on series
    # delete), so the join below is declared explicitly instead.
    series_id: Mapped[int | None] = mapped_column(Integer, index=True)
    series_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)

    category: Mapped[Category | None] = relationship("Category", back_populates="posts")
    tags: Mapped[list[Tag]] = relationship("Tag", secondary=post_tags, back_populates="posts")
    series: Mapped[Series | None] = relationship(
        "Series",
        back_populates="posts",
        primaryjoin="Post.series_id == Series.id",
        foreign_keys="Post.series_id",
    )
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


class PushSubscription(Base):
    """A reader's browser Web Push (RFC 8030) subscription.

    ``endpoint`` is the push service URL the browser returned at subscribe time;
    it is unique so re-subscribing the same browser upserts instead of
    duplicating rows. ``p256dh``/``auth`` are the subscription keys used to
    encrypt the notification payload for this endpoint (http-ece). Long-running
    subscribers whose endpoint goes 410/404 are removed on the next dispatch —
    the push service drops subscriptions that are no longer reachable.

    (DEC-055, TASK-117)
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Push endpoints are long vendor URLs; 500 accommodates the longest known
    # (Firefox/Web Push protocol endpoints) with headroom.
    endpoint: Mapped[str] = mapped_column(String(500), unique=True, nullable=False, index=True)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


class Series(Base):
    """An ordered group of posts presented as a multi-part sequence (DEC-056).

    Posts opt into a series via ``Post.series_id``; ``Post.series_order`` fixes
    their position so the public series detail renders a deterministic order the
    author controls (rather than feed order). ``slug`` is unique and follows the
    same slug pattern as posts so series URLs stay stable and shareable.

    (DEC-056, TASK-121)
    """

    __tablename__ = "series"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), unique=True, index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    # Ordered by series_order then id so equal orders fall back to insertion
    # order deterministically (TASK-121).
    posts: Mapped[list[Post]] = relationship(
        "Post",
        back_populates="series",
        order_by="Post.series_order, Post.id",
        primaryjoin="Post.series_id == Series.id",
        foreign_keys="Post.series_id",
    )
