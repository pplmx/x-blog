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
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    # ReaderAccount lives in app.auth (deliberately, next to the other account
    # model); import only for type checking so the string-based relationship
    # annotation resolves under pyright without a runtime import cycle.
    from app.auth import ReaderAccount

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
    # When a moderator last reviewed this comment (approve OR reject). Null
    # distinguishes "still pending" from "reviewed and rejected" for the
    # author's comment-history status (DEC-066, TASK-139).
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    # Optional reader that authored the comment (None = anonymous free-text
    # commenter). Set only from the reader JWT at create time — client-supplied
    # identity is never trusted (see routers/comments.py). The email is NOT
    # stored here: it lives on reader_accounts; anonymous comments keep their
    # free-text email column.
    reader_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # Idempotency anchor for full-blog restore (DEC-082): the backup export
    # stamps each comment with "{post_slug}#{export-ordinal}" and restore
    # upserts by (post_id, import_key), so re-importing the same snapshot never
    # duplicates comments. Nullable + non-indexed: only used during restore;
    # additive per DEC-009.
    import_key: Mapped[str | None] = mapped_column(String(100), nullable=True)

    post: Mapped[Post] = relationship("Post", back_populates="comments")
    parent: Mapped[Comment | None] = relationship("Comment", remote_side=[id], backref="replies")
    # Reader account that authored the comment (None for anonymous). No DB FK on
    # reader_id (additive column per DEC-009 — SQLite alembic can't add an
    # FK-carrying column to an existing table); the join is explicit, mirroring
    # the ReaderBookmark/Series pattern.
    reader: Mapped[ReaderAccount | None] = relationship(
        "ReaderAccount",
        primaryjoin="Comment.reader_id == ReaderAccount.id",
        foreign_keys="Comment.reader_id",
    )


class ReaderBookmark(Base):
    """A reader's saved post (cloud-synced bookmarks, DEC-059/TASK-132).

    ``reader_accounts.id`` ↔ ``posts.id`` pair is unique (one bookmark per
    post per reader). Referential integrity is enforced at the ORM layer and
    by a DB-level unique constraint on the pair; the migration creates the
    table entirely additively (DEC-009).
    """

    __tablename__ = "reader_bookmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    post_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("reader_id", "post_id", name="uq_reader_bookmarks_reader_post"),)

    # No DB-level FK on the columns (SQLite alembic can't add FK-carrying
    # columns to existing tables, DEC-009) — the join is declared explicitly,
    # mirroring the Post.series_id pattern.
    post: Mapped[Post] = relationship(
        "Post",
        primaryjoin="ReaderBookmark.post_id == Post.id",
        foreign_keys="ReaderBookmark.post_id",
    )


class CommentSubscription(Base):
    """A reader following a post's comment thread (DEC-078/TASK-150).

    One row per reader↔post pair (unique constraint): the reader opted in to a
    Web Push whenever a *new comment* on the post is approved. Distinct from
    reply notifications (DEC-064), which only target the replied-to author —
    this follows the whole discussion. Additive table, no DB-level FK on the
    columns (SQLite alembic can't add FK-carrying columns to existing tables,
    DEC-009); integrity (unknown post/reader) is enforced at the API layer,
    mirroring ReaderBookmark/PushSubscription.
    """

    __tablename__ = "comment_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    post_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("reader_id", "post_id", name="uq_comment_subscriptions_reader_post"),)

    post: Mapped[Post] = relationship(
        "Post",
        primaryjoin="CommentSubscription.post_id == Post.id",
        foreign_keys="CommentSubscription.post_id",
    )


class PushSubscription(Base):
    """A reader's browser Web Push (RFC 8030) subscription.

    ``endpoint`` is the push service URL the browser returned at subscribe time;
    it is unique so re-subscribing the same browser upserts instead of
    duplicating rows. ``p256dh``/``auth`` are the subscription keys used to
    encrypt the notification payload for this endpoint (http-ece). Long-running
    subscribers whose endpoint goes 410/404 are removed on the next dispatch —
    the push service drops subscriptions that are no longer reachable.

    ``reader_id`` (nullable, DEC-064/TASK-137) binds the subscription to the
    reader account that subscribed, enabling targeted notifications (e.g. "someone
    replied to your comment"). Anonymous subscriptions (None) still receive the
    superuser broadcast. No DB FK on the column (additive per DEC-009).

    (DEC-055, TASK-117; DEC-064, TASK-137)
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    # Push endpoints are long vendor URLs; 500 accommodates the longest known
    # (Firefox/Web Push protocol endpoints) with headroom.
    endpoint: Mapped[str] = mapped_column(String(500), unique=True, nullable=False, index=True)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    # Reader account that subscribed this browser (None = anonymous). Enables
    # targeted per-reader notifications (DEC-064, TASK-137).
    reader_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # New-post notification opt-in (DEC-076, TASK-147). When True the browser
    # receives a push when a post is published; new_post_category_id narrows
    # that to a single followed category (None = all new posts). Both additive,
    # no DB FK on the category column (DEC-009 convention).
    want_new_posts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    new_post_category_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)


class AdminPushSubscription(Base):
    """An admin's browser Web Push subscription for moderation alerts (DEC-080).

    The blog moderates every comment, and the author only learns a comment is
    pending by re-opening the admin moderation queue. This table lets an admin
    (superuser or editor, DEC-054) opt a browser into a push when a new comment
    is created — the receiver of the blog's one-sided push arc, which until now
    only went reader-ward (reply/new-post/thread, DEC-064/076/078).

    Deliberately a separate table from ``PushSubscription``: reader rows are
    mixed into anonymous + reader-bound broadcasts (``/api/push/notify`` queries
    every ``PushSubscription``), so mixing admin rows in would leak moderation
    pushes to reader fan-outs. It also mirrors the account-audience separation
    (``User`` vs ``ReaderAccount``, DEC-059). ``endpoint`` is unique per table
    so re-subscribing the same browser upserts; ``user_id`` binds it to the
    admin account (no DB FK — additive per DEC-009; integrity at the API layer,
    mirroring PushSubscription).
    """

    __tablename__ = "admin_push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
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
