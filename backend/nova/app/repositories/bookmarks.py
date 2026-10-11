"""Reader bookmarks, folders, and durable post likes."""

from __future__ import annotations

from datetime import datetime
from typing import Any, cast

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import models
from app.cache import (
    clear_counter_caches,
)

from ._base import _bump_post_likes, _commit_reader_upsert, escape_like_pattern, is_publicly_visible, utc_now_naive


async def get_reader_bookmark(db: AsyncSession, reader_id: int, post_id: int) -> models.ReaderBookmark | None:
    """Return the reader's bookmark for a post, or None."""
    return (
        (
            await db.execute(
                select(models.ReaderBookmark).where(
                    models.ReaderBookmark.reader_id == reader_id,
                    models.ReaderBookmark.post_id == post_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_reader_bookmark(db: AsyncSession, reader_id: int, post_id: int) -> tuple[models.ReaderBookmark, bool]:
    """Create a bookmark; returns (bookmark, created). Idempotent: re-adding
    an existing bookmark returns the existing row with created=False (merge-
    friendly — a localStorage-first client re-PUTs the same set on login)."""
    existing = await get_reader_bookmark(db, reader_id, post_id)
    if existing:
        return existing, False
    bookmark = models.ReaderBookmark(reader_id=reader_id, post_id=post_id)
    db.add(bookmark)
    if await _commit_reader_upsert(db):
        await db.refresh(bookmark)
        return bookmark, True
    existing = await get_reader_bookmark(db, reader_id, post_id)
    if existing:
        return existing, False
    raise RuntimeError("bookmark insert lost the unique-key race but no row was found")


async def remove_reader_bookmark(db: AsyncSession, reader_id: int, post_id: int) -> bool:
    """Delete a bookmark; returns True if one was removed. Idempotent."""
    bookmark = await get_reader_bookmark(db, reader_id, post_id)
    if not bookmark:
        return False
    await db.delete(bookmark)
    await db.commit()
    return True


async def clear_reader_bookmarks(db: AsyncSession, reader_id: int) -> int:
    """Delete every bookmark the reader has saved. Returns the count removed.
    Idempotent: clearing an already-empty list yields 0 with no error (bulk
    ``delete()`` on a no-op filter commits nothing meaningful). Used by the
    reader's "Clear all bookmarks" action, which must also take effect on the
    cloud copy — not just the localStorage mirror."""
    deleted = cast(
        CursorResult[Any],
        await db.execute(delete(models.ReaderBookmark).where(models.ReaderBookmark.reader_id == reader_id)),
    ).rowcount
    await db.commit()
    return deleted


async def get_reader_post_like(db: AsyncSession, reader_id: int, post_id: int) -> models.ReaderPostLike | None:
    """Return the reader's like for a post, or None."""
    return (
        (
            await db.execute(
                select(models.ReaderPostLike).where(
                    models.ReaderPostLike.reader_id == reader_id,
                    models.ReaderPostLike.post_id == post_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_reader_post_like(db: AsyncSession, reader_id: int, post_id: int) -> tuple[models.ReaderPostLike, bool]:
    """Create a like; returns (like, created). Idempotent: re-adding an
    existing like returns the existing row with created=False (merge-friendly —
    the localStorage-first client re-sends the same set on login, mirroring
    add_reader_bookmark). The durable row is what makes a signed-in reader's
    like cross-device; the public counter is the aggregate badge.

    Row + counter commit in ONE transaction (ISS-574, like_comment's ISS-560
    pattern): the old two-commit path (row commit here, counter bump in the
    router) could crash in between and leave a durable like row whose count
    was never bumped, with no re-sync path. A concurrent duplicate
    (IntegrityError at flush) stays an idempotent no-op; any other failure
    rolls the whole like back."""
    existing = await get_reader_post_like(db, reader_id, post_id)
    if existing:
        return existing, False
    like = models.ReaderPostLike(reader_id=reader_id, post_id=post_id)
    db.add(like)
    try:
        await _bump_post_likes(db, post_id, 1)
        await db.commit()
    except IntegrityError:
        await db.rollback()  # concurrent duplicate → idempotent no-op
        existing = await get_reader_post_like(db, reader_id, post_id)
        if existing:
            return existing, False
        raise RuntimeError("reader-post-like insert lost the unique-key race but no row was found")
    except Exception:
        await db.rollback()
        raise
    # The counter is embedded in the cached post-list payloads (ISS-141);
    # a brand-new like changes it, so drop those caches exactly once per commit.
    clear_counter_caches()
    await db.refresh(like)
    return like, True


async def remove_reader_post_like(db: AsyncSession, reader_id: int, post_id: int) -> bool:
    """Delete a like; returns True if one was removed. Idempotent.

    Row + counter decrement commit in ONE transaction (ISS-574, mirroring
    add_reader_post_like): the old two-commit path could crash between the
    row delete and the counter bump, leaving a vanished like row whose badge
    still counted it — permanently wrong, no re-sync path."""
    like = await get_reader_post_like(db, reader_id, post_id)
    if not like:
        return False
    await db.delete(like)
    try:
        await _bump_post_likes(db, post_id, -1)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    # Counter embeds in cached post-list payloads (ISS-141); drop them once.
    clear_counter_caches()
    return True


async def list_reader_post_likes(
    db: AsyncSession,
    reader_id: int,
    page: int = 1,
    limit: int | None = 100,
    q: str | None = None,
) -> tuple[list[models.Post], int]:
    """Return the reader's liked posts, publicly-visible only, newest like
    first, paginated.

    Post visibility can change after a like; the list must never leak a draft
    or scheduled post on a read path (same invariant as list_reader_bookmarks)
    — visibility is pushed into the SQL WHERE so pages are stable.
    ``limit=None`` returns the complete list (the reader data export uses
    that, RIL ISS-288). ``q`` (optional) filters to liked posts whose title or
    excerpt matches the term (case-insensitive, escape-aware — DEC-413/TASK-432,
    same recall-search pattern as history DEC-148) so a reader can recall a
    specific appreciated post.
    """
    now = utc_now_naive()
    query = (
        select(models.Post)
        .join(models.ReaderPostLike, models.ReaderPostLike.post_id == models.Post.id)
        .where(
            models.ReaderPostLike.reader_id == reader_id,
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    )
    if q and q.strip():
        term = f"%{escape_like_pattern(q.strip())}%"
        query = query.where(
            or_(
                models.Post.title.ilike(term, escape="\\"),
                models.Post.excerpt.ilike(term, escape="\\"),
            )
        )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    query = query.options(
        joinedload(models.Post.category),
        joinedload(models.Post.tags),
        joinedload(models.Post.series),
        joinedload(models.Post.author),
    ).order_by(models.ReaderPostLike.created_at.desc(), models.Post.id.desc())
    if limit is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    rows = list((await db.execute(query)).unique().scalars())
    return [p for p in rows if is_publicly_visible(p)], total


async def list_reader_post_likes_for_export(
    db: AsyncSession, reader_id: int
) -> list[tuple[models.Post, datetime | None]]:
    """Complete liked-posts list for the reader data export (round 360).

    Like list_reader_post_likes but carries each like's ``created_at`` (the
    bundle wants when the reader liked the post) and is deliberately
    unbounded — a backup must be complete, never capped at the list endpoint's
    default limit (same stance as bookmarks, RIL ISS-288). Publicly-visible
    posts only, newest like first; the same filters as the read path so a
    liked post that became a draft no longer shows here.
    """
    now = utc_now_naive()
    rows = (
        await db.execute(
            select(models.Post, models.ReaderPostLike.created_at)
            .join(models.ReaderPostLike, models.ReaderPostLike.post_id == models.Post.id)
            .where(
                models.ReaderPostLike.reader_id == reader_id,
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            )
            .order_by(models.ReaderPostLike.created_at.desc(), models.Post.id.desc())
        )
    ).all()
    return [(post, liked_at) for post, liked_at in rows if is_publicly_visible(post)]


async def list_reader_public_bookmarks(
    db: AsyncSession,
    reader_id: int,
    page: int = 1,
    limit: int | None = 100,
) -> tuple[list[models.Post], int]:
    """Return the reader's bookmarked posts, publicly-visible only, for their
    public "Saved posts" tab (round 363, DEC-399).

    Same shape and invariants as list_reader_post_likes: only publicly-visible
    posts (never a draft/scheduled post on a read path), newest bookmark first,
    paginated. ``limit=None`` is not needed here (no export call uses it yet)
    but kept for symmetry with the sibling listers.
    """
    now = utc_now_naive()
    query = (
        select(models.Post)
        .join(models.ReaderBookmark, models.ReaderBookmark.post_id == models.Post.id)
        .where(
            models.ReaderBookmark.reader_id == reader_id,
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    query = query.options(
        joinedload(models.Post.category),
        joinedload(models.Post.tags),
        joinedload(models.Post.series),
        joinedload(models.Post.author),
    ).order_by(models.ReaderBookmark.created_at.desc(), models.Post.id.desc())
    if limit is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    rows = list((await db.execute(query)).unique().scalars())
    return [p for p in rows if is_publicly_visible(p)], total


async def list_reader_bookmarks(
    db: AsyncSession,
    reader_id: int,
    folder_id: int | None = None,
    done: bool | None = None,
    page: int = 1,
    limit: int | None = 100,
) -> tuple[list[tuple[models.Post, int | None, str | None, bool]], int]:
    """Return the reader's bookmark rows as (post, folder_id, folder_name,
    done), publicly-visible only, newest bookmark first, paginated.

    Post timestamps/visibility can change after a bookmark is saved; the list
    must not leak a draft or scheduled post on a read path (same invariant as
    the public post/comment read paths) — visibility is pushed into the SQL
    WHERE so pages are stable and non-visible posts simply don't appear.
    ``folder_id`` (if given) filters to that folder; ``done`` (if given)
    filters to the To-read (False) or Done (True) queue state (round 361,
    DEC-395). Returns (items, total), where total counts the reader's
    publicly-visible bookmarks (bounded paging instead of loading every row —
    ISS-142; DEC-120/TASK-172). Pass ``limit=None`` for the *complete* list
    (no offset/LIMIT) — the reader data export uses that so its portable
    bundle is never silently truncated to this default page size (RIL
    ISS-288).
    """
    now = utc_now_naive()
    query = (
        select(models.Post, models.ReaderBookmark.folder_id, models.BookmarkFolder.name, models.ReaderBookmark.done)
        .join(models.ReaderBookmark, models.ReaderBookmark.post_id == models.Post.id)
        .outerjoin(models.BookmarkFolder, models.ReaderBookmark.folder_id == models.BookmarkFolder.id)
        .where(
            models.ReaderBookmark.reader_id == reader_id,
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    )
    if folder_id is not None:
        query = query.where(models.ReaderBookmark.folder_id == folder_id)
    if done is not None:
        query = query.where(models.ReaderBookmark.done.is_(done))
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    query = query.options(joinedload(models.Post.category), joinedload(models.Post.tags)).order_by(
        models.ReaderBookmark.created_at.desc(), models.Post.id.desc()
    )
    if limit is not None:
        query = query.offset((page - 1) * limit).limit(limit)
    rows = (await db.execute(query)).unique().all()
    # SQL already guarantees visibility; the predicate stays as a belt-and-braces
    # guard against any drift between the SQL filter and is_publicly_visible.
    return [(post, fid, fname, d) for post, fid, fname, d in rows if is_publicly_visible(post)], total


async def get_bookmark_folder(db: AsyncSession, reader_id: int, folder_id: int) -> models.BookmarkFolder | None:
    """Return one of the reader's folders (ownership-scoped), or None."""
    return (
        (
            await db.execute(
                select(models.BookmarkFolder).where(
                    models.BookmarkFolder.id == folder_id,
                    models.BookmarkFolder.reader_id == reader_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def list_reader_bookmark_folders(db: AsyncSession, reader_id: int) -> list[tuple[models.BookmarkFolder, int]]:
    """Return (folder, bookmark_count) for the reader's folders, name asc."""
    rows = (
        await db.execute(
            select(models.BookmarkFolder, func.count(models.ReaderBookmark.id))
            .outerjoin(
                models.ReaderBookmark,
                and_(
                    models.ReaderBookmark.folder_id == models.BookmarkFolder.id,
                    models.ReaderBookmark.reader_id == reader_id,
                ),
            )
            .where(models.BookmarkFolder.reader_id == reader_id)
            .group_by(models.BookmarkFolder.id)
            .order_by(models.BookmarkFolder.name.asc())
        )
    ).all()
    return [(folder, count) for folder, count in rows]


async def create_bookmark_folder(db: AsyncSession, reader_id: int, name: str) -> tuple[models.BookmarkFolder, bool]:
    """Create a folder; returns (folder, created). Idempotent: a folder with
    the same name already existing returns it with created=False."""
    name = name.strip()
    existing = (
        (
            await db.execute(
                select(models.BookmarkFolder).where(
                    models.BookmarkFolder.reader_id == reader_id, models.BookmarkFolder.name == name
                )
            )
        )
        .scalars()
        .first()
    )
    if existing:
        return existing, False
    folder = models.BookmarkFolder(reader_id=reader_id, name=name)
    db.add(folder)
    if await _commit_reader_upsert(db):
        await db.refresh(folder)
        return folder, True
    existing = (
        (
            await db.execute(
                select(models.BookmarkFolder).where(
                    models.BookmarkFolder.reader_id == reader_id, models.BookmarkFolder.name == name
                )
            )
        )
        .scalars()
        .first()
    )
    if existing:
        return existing, False
    raise RuntimeError("bookmark folder insert lost the unique-key race but no row was found")


async def rename_bookmark_folder(
    db: AsyncSession, reader_id: int, folder_id: int, name: str
) -> models.BookmarkFolder | None:
    """Rename a folder; returns the folder, or None if not found or the new
    name collides with another of the reader's folders."""
    folder = await get_bookmark_folder(db, reader_id, folder_id)
    if not folder:
        return None
    name = name.strip()
    if name != folder.name:
        dup = (
            (
                await db.execute(
                    select(models.BookmarkFolder).where(
                        models.BookmarkFolder.reader_id == reader_id,
                        models.BookmarkFolder.name == name,
                        models.BookmarkFolder.id != folder_id,
                    )
                )
            )
            .scalars()
            .first()
        )
        if dup:
            return None
    folder.name = name
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def delete_bookmark_folder(db: AsyncSession, reader_id: int, folder_id: int) -> bool:
    """Delete a folder; unassigns its bookmarks (sets folder_id=None).
    Returns True if a folder was removed, False if not found. Idempotent."""
    folder = await get_bookmark_folder(db, reader_id, folder_id)
    if not folder:
        return False
    await db.execute(
        update(models.ReaderBookmark)
        .where(
            models.ReaderBookmark.folder_id == folder_id,
            models.ReaderBookmark.reader_id == reader_id,
        )
        .values({"folder_id": None})
    )
    await db.delete(folder)
    await db.commit()
    return True


async def set_bookmark_folder(
    db: AsyncSession, reader_id: int, post_id: int, folder_id: int | None
) -> models.ReaderBookmark | None:
    """File a bookmark into a folder (or clear it with folder_id=None).
    Ownership-scoped: the folder must belong to the reader. Returns the
    updated bookmark, or None if the bookmark doesn't exist or the folder is
    not the reader's."""
    bookmark = await get_reader_bookmark(db, reader_id, post_id)
    if not bookmark:
        return None
    if folder_id is not None and not await get_bookmark_folder(db, reader_id, folder_id):
        return None
    bookmark.folder_id = folder_id
    db.add(bookmark)
    await db.commit()
    await db.refresh(bookmark)
    return bookmark


async def set_reader_bookmark_done(
    db: AsyncSession, reader_id: int, post_id: int, done: bool
) -> models.ReaderBookmark | None:
    """Move a bookmark between To-read and Done (round 361, DEC-395).

    Ownership-scoped: only the reader's own bookmark. Returns the updated
    bookmark, or None if the post isn't bookmarked by this reader (404).
    Idempotent — setting Done when it already is Done is a no-op.
    """
    bookmark = await get_reader_bookmark(db, reader_id, post_id)
    if not bookmark:
        return None
    bookmark.done = done
    db.add(bookmark)
    await db.commit()
    await db.refresh(bookmark)
    return bookmark
