"""SQLAlchemy ORM models, typed in the SQLAlchemy 2.0 style.

Models use ``Mapped[...] = mapped_column(...)`` so class attribute access on
*instances* carries the true Python type (``post.published`` is ``bool | None``,
not ``Column[bool]``). This makes static type checking (pyright) meaningful.

Nullability intentionally mirrors the legacy schema 1:1: columns that were
declared without ``nullable=False`` stay Optional even where the app always
provides a value (e.g. ``published``, ``views``, timestamps). Tightening those
constraints is a separate, deliberate schema migration, not this refactor.
"""

from datetime import UTC, date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    true,
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
    revisions: Mapped[list[PostRevision]] = relationship(
        "PostRevision",
        back_populates="post",
        cascade="all, delete-orphan",
        order_by="desc(PostRevision.id)",
        # post_id is a plain integer (no DB-level FK, SQLite-safe additive
        # convention, DEC-009), so the ORM join must be explicit — same as the
        # series_id relationship above.
        primaryjoin="Post.id == PostRevision.post_id",
        foreign_keys="PostRevision.post_id",
    )


class PostRevision(Base):
    """An immutable snapshot of a post's editable fields (DEC-158, TASK-191).

    Captured on every admin create/update (and before a restore, so a restore
    is itself part of the history / undo-able). Lets the author view and
    restore any past state — per-post version history on top of the whole-blog
    backup (DEC-082). Additive table; the FK is a plain integer + ORM-level
    relationship (SQLite alembic can't add FK-carrying columns to existing
    tables, DEC-009), with cascade enforced at the ORM layer.
    """

    __tablename__ = "post_revisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    post_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    excerpt: Mapped[str | None] = mapped_column(String(500))
    cover_image: Mapped[str | None] = mapped_column(String(500))
    category_id: Mapped[int | None] = mapped_column(Integer)
    series_id: Mapped[int | None] = mapped_column(Integer)
    series_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    publish_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pinned: Mapped[bool | None] = mapped_column(Boolean, default=False)
    published: Mapped[bool | None] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        index=True,
    )

    post: Mapped[Post] = relationship(
        "Post",
        back_populates="revisions",
        primaryjoin="PostRevision.post_id == Post.id",
        foreign_keys="PostRevision.post_id",
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)

    posts: Mapped[list[Post]] = relationship("Post", back_populates="category")


class CategoryFollow(Base):
    """A reader following a category (DEC-140, TASK-182).

    Durable, reader-level intent (cross-device, unlike the per-device new-post
    category pin on PushSubscription from DEC-076): a follow with notify=true
    is fanned out in new-post dispatch for that category, and appears in the
    reader's Followed-categories list. ``notify`` decouples tracking from push
    (mirrors SeriesFollow, DEC-138/TASK-181). Additive table, no DB-level FK on
    the columns (SQLite alembic can't add FK-carrying columns to existing
    tables, DEC-009); integrity enforced at the API layer.
    """

    __tablename__ = "category_follows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    category_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    notify: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("reader_id", "category_id", name="uq_category_follows_reader_category"),)

    category: Mapped[Category | None] = relationship(
        "Category",
        primaryjoin="CategoryFollow.category_id == Category.id",
        foreign_keys="CategoryFollow.category_id",
    )


class SearchLog(Base):
    """Aggregated public search-term analytics (DEC-152, TASK-188).

    One row per normalized (lowercased, trimmed) query with a counter and the
    last-searched time. Aggregate-only and never linked to a reader, so it is
    privacy-safe while giving the operator visibility into what visitors look
    for. Additive table; no DB-level FK needed (DEC-009).
    """

    __tablename__ = "search_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    query: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_searched_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


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
    # Comment upvote count (DEC-092/TASK-158): anonymous count++, mirrors the
    # post-likes precedent. The backend only ever increments it (atomic update
    # in crud.increment_comment_likes), never decrements.
    likes: Mapped[int] = mapped_column(Integer, default=0, nullable=False, server_default="0")
    # When a moderator last reviewed this comment (approve OR reject). Null
    # distinguishes "still pending" from "reviewed and rejected" for the
    # author's comment-history status (DEC-066, TASK-139).
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # When the reader-author last edited their own comment (DEC-096, TASK-160).
    # Null = never edited; set by PATCH /api/reader/me/comments/{id}. Additive.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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


class CommentFlag(Base):
    """A reader flagging a comment for moderation (DEC-108, TASK-166).

    One flag per comment per visitor is enforced by the unique (comment_id,
    ip_key) pair, so repeated clicks by the same person are idempotent and the
    moderator sees a count of distinct reporters, not click spam. Additive table,
    no DB-level FK on the columns (SQLite alembic can't add FK-carrying columns
    to existing tables, DEC-009).
    """

    __tablename__ = "comment_flags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    comment_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # Proxy-aware source key (same resolver as the rate limiter / stored ip).
    ip_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("comment_id", "ip_key", name="uq_comment_flags_comment_ip"),)


class BookmarkFolder(Base):
    """A reader's bookmark folder/collection (DEC-120, TASK-172).

    One folder per reader with a unique (reader_id, name) pair, so a reader
    can organize saved posts by topic/project. Additive table, no DB-level FK
    (SQLite alembic can't add FK-carrying columns to existing tables,
    DEC-009); ownership is enforced at the API layer.
    """

    __tablename__ = "bookmark_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("reader_id", "name", name="uq_bookmark_folders_reader_name"),)


class ReaderBookmark(Base):
    """A reader's saved post (cloud-synced bookmarks, DEC-059/TASK-132).

    ``reader_accounts.id`` ↔ ``posts.id`` pair is unique (one bookmark per
    post per reader). An optional ``folder_id`` files the save into a
    BookmarkFolder (DEC-120/TASK-172). Referential integrity is enforced at
    the ORM layer and by a DB-level unique constraint on the pair; the
    migration creates the table/additive column entirely additively (DEC-009).
    """

    __tablename__ = "reader_bookmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    post_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    folder_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("reader_id", "post_id", name="uq_reader_bookmarks_reader_post"),)

    # No DB-level FK on the columns (SQLite alembic can't add FK-carrying
    # columns to existing tables, DEC-009) — the join is declared explicitly,
    # mirroring the Post.series_id pattern. Ownership/folder validity is
    # enforced at the API layer.
    post: Mapped[Post] = relationship(
        "Post",
        primaryjoin="ReaderBookmark.post_id == Post.id",
        foreign_keys="ReaderBookmark.post_id",
    )
    folder: Mapped[BookmarkFolder | None] = relationship(
        "BookmarkFolder",
        primaryjoin="ReaderBookmark.folder_id == BookmarkFolder.id",
        foreign_keys="ReaderBookmark.folder_id",
    )


class ReadingHistory(Base):
    """A reader's server-backed view history (DEC-116, TASK-170).

    One row per reader↔post pair (unique constraint) holding the last time the
    reader viewed the post — an upsert updates ``viewed_at`` in place so there
    are no duplicate rows. This makes a signed-in reader's Continue-reading
    trail follow them across devices (the client-side localStorage trail,
    DEC-104/TASK-169, remains the guest fallback). Additive table, no DB-level
    FK on the columns (SQLite alembic can't add FK-carrying columns to existing
    tables, DEC-009; integrity enforced at the API layer like ReaderBookmark).
    """

    __tablename__ = "reading_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    post_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    viewed_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    # Per-post resume position (DEC-167, TASK-200): last saved vertical scroll
    # offset in px, so a returning reader can be dropped back where they left
    # off. Nullable + additive. Updated in place by the record endpoint only
    # when the client sends an explicit value (plain views preserve it).
    scroll_position: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (UniqueConstraint("reader_id", "post_id", name="uq_reading_history_reader_post"),)

    post: Mapped[Post] = relationship(
        "Post",
        primaryjoin="ReadingHistory.post_id == Post.id",
        foreign_keys="ReadingHistory.post_id",
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


class ReaderNotification(Base):
    """A durable, in-app notification for a signed-in reader (DEC-160, TASK-192).

    The blog's reader-facing notifications (new post in a followed
    series/category, a reply to the reader's comment, a new comment on a
    followed thread) are today delivered only as fire-and-forget browser Web
    Push — a reader who misses the push (browser closed, second device, blocked
    notifications) has no durable record of what they follow or what replied to
    them. This table persists one row per reader-facing notification event so
    a signed-in reader can review their activity in-app as a read/unread list,
    each row deep-linking to the source post/comment. Additive table, no DB-level
    FK (SQLite alembic can't add FK-carrying columns to existing tables, DEC-009);
    integrity (unknown reader) is enforced at the API layer like the other reader
    extension tables. Rows are written at the same dispatch points that fire the
    push, so the inbox and the push stay in sync.
    """

    __tablename__ = "reader_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # kind ∈ {new_post, series_new_part, reply, thread_comment}; distinguishes
    # the event source for iconography/filtering on the frontend.
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="new_post")
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(String(500))
    # Deep-link to the source (post page / post + comment anchor) so tapping an
    # inbox row navigates the reader to the thing they were notified about.
    url: Mapped[str | None] = mapped_column(String(500))
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        index=True,
    )


class SeriesFollow(Base):
    """A reader following a series (DEC-132, TASK-178; notify control DEC-138/TASK-181).

    One row per reader↔series pair (unique) records the reader's intent to be
    notified when a new public post is published in the series. ``notify``
    defaults true and decouples *tracking* (the follow, which powers the home
    "Your series" row) from *push*: a follow with notify=false still shows in
    the reader's followed series but is not fanned out in new-part dispatch.
    Delivery goes through the reader's browser Web Push subscriptions
    (PushSubscription); this table is the series-scoped opt-in. Additive table,
    no DB-level FK on the columns (SQLite alembic can't add FK-carrying columns
    to existing tables, DEC-009); integrity enforced at the API layer.
    """

    __tablename__ = "series_follows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    reader_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    series_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    notify: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    __table_args__ = (UniqueConstraint("reader_id", "series_id", name="uq_series_follows_reader_series"),)

    series: Mapped[Series | None] = relationship(
        "Series",
        primaryjoin="SeriesFollow.series_id == Series.id",
        foreign_keys="SeriesFollow.series_id",
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


class PostViewsDaily(Base):
    """Per-day view counts for reading-trend analytics (DEC-086).

    One row per (post, calendar day) — unique pair, monotonic ``views`` counter
    upserted from the same write-on-read path as ``Post.views``. This is the
    trend signal an operator's dashboard needs (which posts are gaining
    traction day by day); the aggregate ``Post.views`` counter stays as-is.

    Additive table, no DB-level FK on ``post_id`` (SQLite alembic can't add
    FK-carrying columns to existing tables, DEC-009) — integrity at the API
    layer, mirroring ReaderBookmark/CommentSubscription.
    """

    __tablename__ = "post_views_daily"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    post_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    views: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("post_id", "day", name="uq_post_views_daily_post_day"),)


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


class SiteSetting(Base):
    """Operator-controlled runtime settings, stored as key/value (DEC-100, TASK-162).

    The only current key is ``auto_approve_reader_comments`` (a boolean flag
    persisted as "true"/"false") which the comment-create path resolves with an
    env fallback, so an admin can flip the moderation trust tier at runtime
    without a redeploy. Additive table — no changes to existing tables (DEC-009).
    """

    __tablename__ = "site_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
