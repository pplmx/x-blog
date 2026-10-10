"""Shared cross-domain helpers and constants moved verbatim from ``app/crud.py`` so the repository domain modules import them from here instead of duplicating them (Phase 1 of the crud.py cleanup)."""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import models, schemas
from app.middleware import get_logger

logger = get_logger(__name__)


# Tables whose post_id column is a plain integer — no DB-level FK and no ORM
# cascade from Post (the DEC-009 additive-table convention, integrity enforced
# at the API layer). delete_post must purge these rows explicitly or every post
# delete leaves permanent orphan rows (RIL ISS-296).
# Cap on the recommendation candidate pool (round 278): recommend_posts scores
# candidates in Python, so without a bound it would materialize every public
# post per request — an O(all posts) authenticated-triggerable load. 2000 keeps
# behavior identical on blogs under the cap and hard-bounds a pathological one.
CANDIDATE_SCAN_LIMIT = 2000


_POST_CHILD_TABLES: list[tuple[Any, Any]] = [
    (models.ReaderBookmark, models.ReaderBookmark.post_id),
    (models.ReadingHistory, models.ReadingHistory.post_id),
    (models.CommentSubscription, models.CommentSubscription.post_id),
    (models.PostViewsDaily, models.PostViewsDaily.post_id),
    # Reader likes are the same additive DEC-009 table class as the others:
    # deleting a post must not leave orphaned like rows behind (they would
    # drift the reader's like count and, on SQLite id reuse, could surface as
    # "liked" on an unrelated later post — deep-dive finding).
    (models.ReaderPostLike, models.ReaderPostLike.post_id),
    # Guest (anonymous) thread subscriptions are the same additive DEC-009
    # table class with no ORM cascade from Post: deleting a post must purge
    # its (email, post_id) rows too, or on SQLite autoincrement reuse a later
    # post could inherit ghost subscriptions and re-fire email that the guest
    # never opted into for it (same class as reader likes — deep-dive finding).
    (models.GuestCommentSubscription, models.GuestCommentSubscription.post_id),
]


def utc_now_naive() -> datetime:
    """Current UTC time as a naive datetime.

    `publish_at`/`created_at` are stored as naive UTC in the DateTime columns
    (clients send naive ISO strings; the ORM default uses datetime.now(UTC)).
    Comparing against naive-UTC keeps all publish_at guards consistent across
    hosts, regardless of server local timezone.
    """
    return datetime.now(UTC).replace(tzinfo=None)


# Device clocks drift; how far ahead of the server a history-import read time
# is allowed to be before being treated as a bad clock (TASK-348/ISS-450).
# A well-synced device is within seconds of the server, so a couple of minutes
# of slack never trips a legitimate import, while a year-ahead "2031" read —
# which would otherwise pin the post at the top of history forever — is always
# caught.
HISTORY_IMPORT_CLOCK_SKEW = timedelta(minutes=2)


def is_publicly_visible(post: models.Post) -> bool:
    """A post is public only when published and its publish_at (if any) has passed.

    publish_at is stored as naive UTC (see utc_now_naive); compare against
    naive-UTC now so a non-UTC server host cannot hide or leak scheduled posts.
    Shared by the public post read paths and the public comment-create guard.
    """
    if not post.published:
        return False
    if post.publish_at is None:
        return True
    publish_at = post.publish_at
    if publish_at.tzinfo is not None:
        publish_at = publish_at.astimezone(UTC).replace(tzinfo=None)
    return publish_at <= utc_now_naive()


def effective_publish_ts(post: models.Post, fallback: datetime | None = None) -> datetime:
    """The timestamp at which readers actually got a post: its scheduled
    publish_at when set, else its created_at (created_at is an ORM default of
    ``datetime.now(UTC)`` — an AWARE value — so normalize to naive UTC here,
    matching the naive ``publish_at`` domain). Both holes fall back to
    ``fallback`` (defaulting to now). Shared by the digest window, RSS/Atom
    feed dates and any "published when" surface so a scheduled post is never
    mis-dated by its draft time (RIL ISS-264)."""
    ts = post.publish_at if post.publish_at is not None else post.created_at
    if ts is None:
        return fallback if fallback is not None else utc_now_naive()
    if ts.tzinfo is not None:
        ts = ts.astimezone(UTC).replace(tzinfo=None)
    return ts


async def _populate_post_metrics(db: AsyncSession, posts: list[models.Post]) -> None:
    """Fill `comment_count` + `reading_time` on a list of Post in-place.

    comment_count is the approved-comment count per post, computed in ONE
    grouped query (no N+1) so cost scales with the page size. Shared by every
    public PostList-producing path (list / popular / related / adjacent) so a
    PostList consumer never gets a misleading 0 for a post that has comments
    (RIL TASK-109, ISS-089).
    """
    if not posts:
        return
    post_ids = [p.id for p in posts]
    rows = (
        await db.execute(
            select(models.Comment.post_id, func.count(models.Comment.id))
            .where(
                models.Comment.post_id.in_(post_ids),
                models.Comment.is_approved == True,  # noqa: E712
            )
            .group_by(models.Comment.post_id)
        )
    ).all()
    comment_counts = {post_id: int(count) for post_id, count in rows}
    for p in posts:
        p.comment_count = comment_counts.get(p.id, 0)
        p.reading_time = schemas.reading_minutes(p.content or "")


def _effective_publish_col():
    """SQL expression for a post's effective-publish timestamp.

    A post is "published when" its scheduled ``publish_at`` (if set), else its
    ``created_at`` — the same line ``effective_publish_ts`` draws in Python,
    expressed in SQL so ordering/grouping/filtering agree (RIL ISS-265). On
    SQLite the created_at column may carry a ``+00:00`` suffix while publish_at
    is bare naive-UTC text; COALESCE returns whichever is set, and both format
    identically up to the suffix, so string ordering stays aligned.
    """
    return func.coalesce(models.Post.publish_at, models.Post.created_at)


async def _reload_post_eager(db: AsyncSession, post_id: int) -> models.Post | None:
    """Re-fetch a post with its serialization-needed relationships eager-loaded.

    Mutating functions (create/update/clone) build a Post, commit, and hand it
    to response serialization (`schemas.Post` reads category/tags/series/author)
    plus new-post fan-out (webpush reads `post.tags`/`post.series`). In async
    SQLAlchemy those lazy collections must be loaded inside the session's event
    loop — a post-commit lazy load otherwise raises MissingGreenlet. Re-querying
    with the eager options restores the pre-async behavior where the returned
    object carried its relationships.
    """
    return (
        (
            await db.execute(
                select(models.Post)
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
                .where(models.Post.id == post_id)
            )
        )
        .unique()
        .scalars()
        .first()
    )


MAX_REVISIONS_PER_POST = 100


def escape_like_pattern(query: str) -> str:
    """Escape LIKE metacharacters so user input matches literally.

    % and _ would otherwise act as wildcards and degenerate into full-table
    matches (issue #20). Must be paired with ``escape="\\"`` on ilike/like.
    """
    return query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _bump_post_likes(db: AsyncSession, post_id: int, delta: int) -> None:
    """Atomic UPDATE of a post's like counter WITHOUT committing.

    Shared by increment_likes/decrement_likes (standalone commits) and the
    reader like-row paths (ISS-574: merged into the row's own transaction so a
    crash between the two can never leave a durable like row with a counter
    that was never bumped — the same atomicity fix comments got at ISS-560).
    """
    if delta < 0:
        # ``likes > 0`` never matches a NULL row (comparisons with NULL are
        # UNKNOWN), but coalescing keeps the arithmetic honest on the decrement
        # floor: NULL+(-1) via the negative branch is impossible here because
        # the predicate excludes it; the else-branch below must coalesce to
        # make NULL likes incrementable like views above (TASK-535).
        stmt = (
            update(models.Post)
            .where(models.Post.id == post_id, models.Post.likes > 0)
            .values(likes=models.Post.likes + delta)
        )
    else:
        stmt = (
            update(models.Post)
            .where(models.Post.id == post_id)
            .values(likes=func.coalesce(models.Post.likes, 0) + delta)
        )
    await db.execute(stmt)


async def _commit_reader_upsert(db: AsyncSession) -> bool:
    """Commit an additive unique-keyed reader write.

    Returns True on success. If a concurrent duplicate won the unique-key race
    (the same (reader, target) row was committed just before ours), rolls back
    and returns False so the caller re-fetches the winner and reports
    created=False — the merge-friendly PUT contracts stay idempotent and can
    never 500 on an IntegrityError (ISS-143).
    """
    try:
        await db.commit()
        return True
    except IntegrityError:
        await db.rollback()
        return False


# Reading-streak + activity window for the /history summary (DEC-169, TASK-201).
# The heatmap shows the last 52 weeks; entries are produced for every day
# (zeros included) so the frontend renders a complete calendar without gaps.
ACTIVITY_DAYS = 364


# Retention cap per reader: keep the most recent N notifications, pruning older
# rows on insert so the inbox can never grow without bound (mirrors the per-post
# revision cap, DEC-158).
MAX_NOTIFICATIONS_PER_READER = 200


# Reply / thread-comment / @-mention copy (DEC-340, TASK-396): moved here from
# the comments router so the per-reader localization lives with the fan-out
# copy, still operator-overridable via the same env vars (the zh site default
# reads them exactly as before; the English copy is static for now).
REPLY_NOTIF_TITLE = os.getenv("REPLY_NOTIFICATION_TITLE", "有人回复了你的评论")


REPLY_NOTIF_BODY = os.getenv("REPLY_NOTIFICATION_BODY", "《{post_title}》有新回复")


THREAD_NOTIF_TITLE = os.getenv("THREAD_NOTIFICATION_TITLE", "你订阅的讨论有新评论")


THREAD_NOTIF_BODY = os.getenv("THREAD_NOTIFICATION_BODY", "《{post_title}》有新评论")


MENTION_NOTIF_TITLE = os.getenv("MENTION_NOTIFICATION_TITLE", "有人在评论中提到了你")


MENTION_NOTIF_BODY = os.getenv("MENTION_NOTIFICATION_BODY", "{commenter} 在《{post_title}》中提到了你")


# @-mention resolution (DEC-322, TASK-389).
# Hard cap on reader display-names scanned per approved comment: a personal-blog
# reader table resolves in milliseconds, but a pathological scale should fail
# silently (no pick-and-choose partial matching) rather than do unbounded work
# at approval time.
MENTION_SCAN_LIMIT = 2000


MENTION_SUGGEST_LIMIT = 8


def _iso(value: datetime | None) -> str | None:
    """ISO-8601 of a (possibly aware) datetime, or None."""
    return value.isoformat() if value is not None else None


def _from_iso(value: str | None) -> datetime | None:
    """Round-trip an exported ISO string (aware or naive), or None."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    # Restore the same absolute instant in the naive-UTC domain (DEC-213): an
    # exported aware value must not re-enter the DB shifted by the reader's
    # timezone or the session TimeZone.
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed
