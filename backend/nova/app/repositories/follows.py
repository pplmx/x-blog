"""Reader follows across series/category/author/tag/reader and blocks."""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import models

from ._base import (
    _commit_reader_upsert,
    _effective_publish_col,
    _populate_post_metrics,
    is_publicly_visible,
    utc_now_naive,
)


async def get_series_follow(db: AsyncSession, reader_id: int, series_id: int) -> models.SeriesFollow | None:
    """Return the reader's follow for a series, or None."""
    return (
        (
            await db.execute(
                select(models.SeriesFollow).where(
                    models.SeriesFollow.reader_id == reader_id, models.SeriesFollow.series_id == series_id
                )
            )
        )
        .scalars()
        .first()
    )


async def add_series_follow(db: AsyncSession, reader_id: int, series_id: int) -> tuple[models.SeriesFollow, bool]:
    """Follow a series for new-part push; returns (follow, created). Idempotent."""
    existing = await get_series_follow(db, reader_id, series_id)
    if existing:
        return existing, False
    follow = models.SeriesFollow(reader_id=reader_id, series_id=series_id)
    db.add(follow)
    if await _commit_reader_upsert(db):
        await db.refresh(follow)
        return follow, True
    existing = await get_series_follow(db, reader_id, series_id)
    if existing:
        return existing, False
    raise RuntimeError("series follow insert lost the unique-key race but no row was found")


async def remove_series_follow(db: AsyncSession, reader_id: int, series_id: int) -> bool:
    """Unfollow a series; returns True if a follow was removed. Idempotent."""
    follow = await get_series_follow(db, reader_id, series_id)
    if not follow:
        return False
    await db.delete(follow)
    await db.commit()
    return True


async def set_series_follow_notify(
    db: AsyncSession, reader_id: int, series_id: int, notify: bool
) -> models.SeriesFollow | None:
    """Toggle whether a follow pushes new-part notifications. Returns None if not following."""
    follow = await get_series_follow(db, reader_id, series_id)
    if not follow:
        return None
    follow.notify = notify
    await db.commit()
    await db.refresh(follow)
    return follow


async def list_reader_series_follows(db: AsyncSession, reader_id: int) -> list[models.SeriesFollow]:
    """The reader's follow rows (with ``series`` loaded), newest follow first."""
    rows = list(
        (
            await db.execute(
                select(models.SeriesFollow)
                .options(joinedload(models.SeriesFollow.series))
                .where(models.SeriesFollow.reader_id == reader_id)
                .order_by(models.SeriesFollow.created_at.desc(), models.SeriesFollow.id.desc())
            )
        ).scalars()
    )
    return rows


async def list_series_follow_reader_ids(db: AsyncSession, series_id: int) -> list[int]:
    """Reader ids following a series with notifications on (for 'new part' push dispatch)."""
    return [
        reader_id
        for (reader_id,) in (
            await db.execute(
                select(models.SeriesFollow.reader_id).where(
                    models.SeriesFollow.series_id == series_id, models.SeriesFollow.notify.is_(True)
                )
            )
        ).all()
    ]


async def get_category_follow(db: AsyncSession, reader_id: int, category_id: int) -> models.CategoryFollow | None:
    """Return the reader's follow for a category, or None."""
    return (
        (
            await db.execute(
                select(models.CategoryFollow).where(
                    models.CategoryFollow.reader_id == reader_id,
                    models.CategoryFollow.category_id == category_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_category_follow(db: AsyncSession, reader_id: int, category_id: int) -> tuple[models.CategoryFollow, bool]:
    """Follow a category for new-post push; returns (follow, created). Idempotent."""
    existing = await get_category_follow(db, reader_id, category_id)
    if existing:
        return existing, False
    follow = models.CategoryFollow(reader_id=reader_id, category_id=category_id)
    db.add(follow)
    if await _commit_reader_upsert(db):
        await db.refresh(follow)
        return follow, True
    existing = await get_category_follow(db, reader_id, category_id)
    if existing:
        return existing, False
    raise RuntimeError("category follow insert lost the unique-key race but no row was found")


async def remove_category_follow(db: AsyncSession, reader_id: int, category_id: int) -> bool:
    """Unfollow a category; returns True if a follow was removed. Idempotent."""
    follow = await get_category_follow(db, reader_id, category_id)
    if not follow:
        return False
    await db.delete(follow)
    await db.commit()
    return True


async def set_category_follow_notify(
    db: AsyncSession, reader_id: int, category_id: int, notify: bool
) -> models.CategoryFollow | None:
    """Toggle whether a category follow pushes new-posts. Returns None if not following."""
    follow = await get_category_follow(db, reader_id, category_id)
    if not follow:
        return None
    follow.notify = notify
    await db.commit()
    await db.refresh(follow)
    return follow


async def list_reader_category_follows(db: AsyncSession, reader_id: int) -> list[models.CategoryFollow]:
    """The reader's category follow rows (with ``category`` loaded), newest first."""
    rows = list(
        (
            await db.execute(
                select(models.CategoryFollow)
                .options(joinedload(models.CategoryFollow.category))
                .where(models.CategoryFollow.reader_id == reader_id)
                .order_by(models.CategoryFollow.created_at.desc(), models.CategoryFollow.id.desc())
            )
        ).scalars()
    )
    return rows


async def list_category_follow_reader_ids(db: AsyncSession, category_id: int) -> list[int]:
    """Reader ids following a category with notifications on (for new-post dispatch)."""
    return [
        reader_id
        for (reader_id,) in (
            await db.execute(
                select(models.CategoryFollow.reader_id).where(
                    models.CategoryFollow.category_id == category_id,
                    models.CategoryFollow.notify.is_(True),
                )
            )
        ).all()
    ]


async def get_author_follow(db: AsyncSession, reader_id: int, author_id: int) -> models.AuthorFollow | None:
    """A single reader→author follow row, or None (author-follow, round 353)."""
    return (
        (
            await db.execute(
                select(models.AuthorFollow).where(
                    models.AuthorFollow.reader_id == reader_id,
                    models.AuthorFollow.author_id == author_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_author_follow(db: AsyncSession, reader_id: int, author_id: int) -> tuple[models.AuthorFollow, bool]:
    """Follow a writer for new-post fan-out; returns (follow, created). Idempotent."""
    existing = await get_author_follow(db, reader_id, author_id)
    if existing:
        return existing, False
    follow = models.AuthorFollow(reader_id=reader_id, author_id=author_id)
    db.add(follow)
    if await _commit_reader_upsert(db):
        await db.refresh(follow)
        return follow, True
    existing = await get_author_follow(db, reader_id, author_id)
    if existing:
        return existing, False
    raise RuntimeError("author follow insert lost the unique-key race but no row was found")


async def remove_author_follow(db: AsyncSession, reader_id: int, author_id: int) -> bool:
    """Unfollow a writer; returns True if a follow was removed. Idempotent."""
    follow = await get_author_follow(db, reader_id, author_id)
    if not follow:
        return False
    await db.delete(follow)
    await db.commit()
    return True


async def set_author_follow_notify(
    db: AsyncSession, reader_id: int, author_id: int, notify: bool
) -> models.AuthorFollow | None:
    """Toggle whether an author follow pushes new posts. Returns None if not following."""
    follow = await get_author_follow(db, reader_id, author_id)
    if not follow:
        return None
    follow.notify = notify
    await db.commit()
    await db.refresh(follow)
    return follow


async def list_reader_author_follows(db: AsyncSession, reader_id: int) -> list[models.AuthorFollow]:
    """The reader's author follow rows (with ``author`` loaded), newest first."""
    rows = list(
        (
            await db.execute(
                select(models.AuthorFollow)
                .options(joinedload(models.AuthorFollow.author))
                .where(models.AuthorFollow.reader_id == reader_id)
                .order_by(models.AuthorFollow.created_at.desc(), models.AuthorFollow.id.desc())
            )
        ).scalars()
    )
    return rows


async def list_author_follow_reader_ids(db: AsyncSession, author_id: int) -> list[int]:
    """Reader ids following an author with notifications on (for new-post dispatch)."""
    return [
        reader_id
        for (reader_id,) in (
            await db.execute(
                select(models.AuthorFollow.reader_id).where(
                    models.AuthorFollow.author_id == author_id,
                    models.AuthorFollow.notify.is_(True),
                )
            )
        ).all()
    ]


# Reader → reader follow (round 365, DEC-403): the person-shaped axis of the
# follow wheel. Mirrors AuthorFollow exactly — unique (reader_id, followed_id),
# notify decouples tracking from fan-out, list-by-relationship for management.
async def get_reader_follow(db: AsyncSession, reader_id: int, followed_id: int) -> models.ReaderFollow | None:
    """A single reader→reader follow row, or None (reader-follow, round 365)."""
    return (
        (
            await db.execute(
                select(models.ReaderFollow).where(
                    models.ReaderFollow.reader_id == reader_id,
                    models.ReaderFollow.followed_id == followed_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_reader_follow(db: AsyncSession, reader_id: int, followed_id: int) -> tuple[models.ReaderFollow, bool]:
    """Follow another reader; returns (follow, created). Idempotent (201/200)."""
    existing = await get_reader_follow(db, reader_id, followed_id)
    if existing:
        return existing, False
    follow = models.ReaderFollow(reader_id=reader_id, followed_id=followed_id)
    db.add(follow)
    if await _commit_reader_upsert(db):
        await db.refresh(follow)
        return follow, True
    existing = await get_reader_follow(db, reader_id, followed_id)
    if existing:
        return existing, False
    raise RuntimeError("reader follow insert lost the unique-key race but no row was found")


async def remove_reader_follow(db: AsyncSession, reader_id: int, followed_id: int) -> bool:
    """Unfollow a reader; returns True if a follow was removed. Idempotent 204."""
    follow = await get_reader_follow(db, reader_id, followed_id)
    if not follow:
        return False
    await db.delete(follow)
    await db.commit()
    return True


async def list_reader_follows(db: AsyncSession, reader_id: int) -> list[models.ReaderFollow]:
    """The reader's reader-follow rows (with the followed account loaded), newest first."""
    return list(
        (
            await db.execute(
                select(models.ReaderFollow)
                .options(joinedload(models.ReaderFollow.followed))
                .where(models.ReaderFollow.reader_id == reader_id)
                .order_by(models.ReaderFollow.created_at.desc(), models.ReaderFollow.id.desc())
            )
        ).scalars()
    )


async def get_reader_block(db: AsyncSession, blocker_id: int, blocked_id: int) -> models.ReaderBlock | None:
    """A single blocker→blocked row, or None (reader-block, round 379, DEC-425)."""
    return (
        (
            await db.execute(
                select(models.ReaderBlock).where(
                    models.ReaderBlock.blocker_id == blocker_id,
                    models.ReaderBlock.blocked_id == blocked_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_reader_block(db: AsyncSession, blocker_id: int, blocked_id: int) -> tuple[models.ReaderBlock, bool]:
    """Block another reader; returns (block, created). Idempotent (201/200)."""
    existing = await get_reader_block(db, blocker_id, blocked_id)
    if existing:
        return existing, False
    block = models.ReaderBlock(blocker_id=blocker_id, blocked_id=blocked_id)
    db.add(block)
    if await _commit_reader_upsert(db):
        await db.refresh(block)
        return block, True
    existing = await get_reader_block(db, blocker_id, blocked_id)
    if existing:
        return existing, False
    raise RuntimeError("reader block insert lost the unique-key race but no row was found")


async def remove_reader_block(db: AsyncSession, blocker_id: int, blocked_id: int) -> bool:
    """Unblock a reader; returns True if a block was removed. Idempotent 204."""
    block = await get_reader_block(db, blocker_id, blocked_id)
    if not block:
        return False
    await db.delete(block)
    await db.commit()
    return True


async def list_reader_blocks(db: AsyncSession, blocker_id: int) -> list[models.ReaderBlock]:
    """The reader's reader-block rows, newest first (DEC-425)."""
    return list(
        (
            await db.execute(
                select(models.ReaderBlock)
                .where(models.ReaderBlock.blocker_id == blocker_id)
                .order_by(models.ReaderBlock.created_at.desc(), models.ReaderBlock.id.desc())
            )
        ).scalars()
    )


async def readers_who_block(db: AsyncSession, commenter_id: int, target_ids: list[int]) -> set[int]:
    """Reader ids in ``target_ids`` who have blocked ``commenter_id``.

    Suppression helper for the personal fan-outs (DEC-425, TASK-437): a target
    reader who blocked the commenter must not receive that commenter's mention
    / reply / thread-comment / follow-activity events — blocking is a
    receiver-side opt-out, so each dispatch point drops the blocker-of-the-
    commenter before writing any rows. A guest commenter (no reader id) has no
    blocking relation at all.
    """
    if not commenter_id or not target_ids:
        return set()
    rows = (
        await db.execute(
            select(models.ReaderBlock.blocker_id).where(
                models.ReaderBlock.blocker_id.in_(target_ids),
                models.ReaderBlock.blocked_id == commenter_id,
            )
        )
    ).all()
    return {rid for (rid,) in rows}


async def list_reader_follower_ids(db: AsyncSession, followed_id: int) -> list[int]:
    """Reader ids following this reader (for the comment-approval fan-out)."""
    return [
        reader_id
        for (reader_id,) in (
            await db.execute(
                select(models.ReaderFollow.reader_id).where(
                    models.ReaderFollow.followed_id == followed_id,
                    models.ReaderFollow.notify.is_(True),
                )
            )
        ).all()
    ]


async def count_reader_followers(db: AsyncSession, followed_id: int) -> int:
    """How many readers follow this reader (public profile surface)."""
    return (
        await db.execute(
            select(func.count()).select_from(
                select(models.ReaderFollow.reader_id).where(models.ReaderFollow.followed_id == followed_id).subquery()
            )
        )
    ).scalar() or 0


async def is_following_reader(db: AsyncSession, reader_id: int, followed_id: int) -> bool:
    """Whether ``reader_id`` follows ``followed_id`` (auth-gated profile field)."""
    return await get_reader_follow(db, reader_id, followed_id) is not None


async def get_tag_follow(db: AsyncSession, reader_id: int, tag_id: int) -> models.TagFollow | None:
    """Return the reader's follow for a tag, or None."""
    return (
        (
            await db.execute(
                select(models.TagFollow).where(
                    models.TagFollow.reader_id == reader_id,
                    models.TagFollow.tag_id == tag_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_tag_follow(db: AsyncSession, reader_id: int, tag_id: int) -> tuple[models.TagFollow, bool]:
    """Follow a tag for new-post push; returns (follow, created). Idempotent."""
    existing = await get_tag_follow(db, reader_id, tag_id)
    if existing:
        return existing, False
    follow = models.TagFollow(reader_id=reader_id, tag_id=tag_id)
    db.add(follow)
    if await _commit_reader_upsert(db):
        await db.refresh(follow)
        return follow, True
    existing = await get_tag_follow(db, reader_id, tag_id)
    if existing:
        return existing, False
    raise RuntimeError("tag follow insert lost the unique-key race but no row was found")


async def remove_tag_follow(db: AsyncSession, reader_id: int, tag_id: int) -> bool:
    """Unfollow a tag; returns True if a follow was removed. Idempotent."""
    follow = await get_tag_follow(db, reader_id, tag_id)
    if not follow:
        return False
    await db.delete(follow)
    await db.commit()
    return True


async def set_tag_follow_notify(db: AsyncSession, reader_id: int, tag_id: int, notify: bool) -> models.TagFollow | None:
    """Toggle whether a tag follow pushes new-posts. Returns None if not following."""
    follow = await get_tag_follow(db, reader_id, tag_id)
    if not follow:
        return None
    follow.notify = notify
    await db.commit()
    await db.refresh(follow)
    return follow


async def list_reader_tag_follows(db: AsyncSession, reader_id: int) -> list[models.TagFollow]:
    """The reader's tag follow rows (with ``tag`` loaded), newest first."""
    rows = list(
        (
            await db.execute(
                select(models.TagFollow)
                .where(models.TagFollow.reader_id == reader_id)
                .options(joinedload(models.TagFollow.tag))
                .order_by(models.TagFollow.created_at.desc(), models.TagFollow.id.desc())
            )
        ).scalars()
    )
    return rows


async def list_tag_follow_reader_ids(db: AsyncSession, tag_ids: list[int]) -> list[int]:
    """Reader ids following any of a post's tags with notifications on (new-post dispatch).

    Takes the post's whole tag set so the caller makes one query per post rather
    than one per tag; the union is deduped into a set downstream.
    """
    if not tag_ids:
        return []
    return [
        reader_id
        for (reader_id,) in (
            await db.execute(
                select(models.TagFollow.reader_id).where(
                    models.TagFollow.tag_id.in_(tag_ids),
                    models.TagFollow.notify.is_(True),
                )
            )
        ).all()
    ]


async def follows_feed_posts(
    db: AsyncSession, reader_id: int, limit: int = 12, offset: int = 0
) -> tuple[list[models.Post], int]:
    """Recent public posts from the reader's followed categories + series + tags + authors.

    The discovery payoff of the follow model (DEC-142/TASK-183; tag dimension
    DEC-195/TASK-215; author dimension round 354/DEC-381): a post matches if its
    category is one the reader follows OR its series is one they follow OR it
    carries a tag they follow OR its author is one they follow (independent of
    per-follow notify — tracking, not push). Results are public, published,
    deduped (a post is its own row), newest by effective publish time first
    (publish_at ?? created_at, matching the global feed), capped at ``limit``
    with ``offset`` pagination (round-306, DEC-292). A reader following nothing
    gets an empty (list, 0) pair (the frontend hides the row).
    """
    category_ids = [
        cid
        for (cid,) in (
            await db.execute(
                select(models.CategoryFollow.category_id).where(models.CategoryFollow.reader_id == reader_id)
            )
        ).all()
    ]
    series_ids = [
        sid
        for (sid,) in (
            await db.execute(select(models.SeriesFollow.series_id).where(models.SeriesFollow.reader_id == reader_id))
        ).all()
    ]
    author_ids = [
        aid
        for (aid,) in (
            await db.execute(select(models.AuthorFollow.author_id).where(models.AuthorFollow.reader_id == reader_id))
        ).all()
    ]
    tag_ids = [
        tid
        for (tid,) in (
            await db.execute(select(models.TagFollow.tag_id).where(models.TagFollow.reader_id == reader_id))
        ).all()
    ]
    if not category_ids and not series_ids and not tag_ids and not author_ids:
        return [], 0

    now = utc_now_naive()
    scope = []
    if category_ids:
        scope.append(models.Post.category_id.in_(category_ids))
    if series_ids:
        scope.append(models.Post.series_id.in_(series_ids))
    if author_ids:
        scope.append(models.Post.author_id.in_(author_ids))
    if tag_ids:
        scope.append(
            models.Post.id.in_(select(models.post_tags.c.post_id).where(models.post_tags.c.tag_id.in_(tag_ids)))
        )

    query = (
        select(models.Post)
        .where(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            or_(*scope),
        )
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
            joinedload(models.Post.series),
            joinedload(models.Post.author),
        )
    )

    # Count before pagination (the global feed pattern) so the reader can page
    # through every follow hit, not just the home-section cap.
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0

    result = [
        post
        for post in list(
            (
                await db.execute(
                    query.order_by(_effective_publish_col().desc(), models.Post.id.desc()).offset(offset).limit(limit)
                )
            )
            .unique()
            .scalars()
        )
        if is_publicly_visible(post)
    ]
    await _populate_post_metrics(db, result)
    return result, total


async def get_follow_stats(db: AsyncSession, limit: int = 5) -> dict:
    """Operator-facing follow analytics (DEC-144, TASK-184).

    Counts are notify-independent (tracking, not push): they capture how many
    readers follow each series and category, plus totals, so the author can see
    what readers track. Top-N are ordered by follower count desc, then id desc
    for stable ordering.
    """
    series_rows = (
        await db.execute(
            select(models.SeriesFollow.series_id, func.count(models.SeriesFollow.id))
            .group_by(models.SeriesFollow.series_id)
            .order_by(func.count(models.SeriesFollow.id).desc(), models.SeriesFollow.series_id.desc())
            .limit(limit)
        )
    ).all()
    category_rows = (
        await db.execute(
            select(models.CategoryFollow.category_id, func.count(models.CategoryFollow.id))
            .group_by(models.CategoryFollow.category_id)
            .order_by(func.count(models.CategoryFollow.id).desc(), models.CategoryFollow.category_id.desc())
            .limit(limit)
        )
    ).all()
    total_series = (await db.execute(select(func.count(models.SeriesFollow.id)))).scalar() or 0
    total_categories = (await db.execute(select(func.count(models.CategoryFollow.id)))).scalar() or 0

    series_ids = [sid for sid, _ in series_rows]
    series_map = (
        {
            s.id: s
            for s in list((await db.execute(select(models.Series).where(models.Series.id.in_(series_ids)))).scalars())
        }
        if series_ids
        else {}
    )

    category_ids = [cid for cid, _ in category_rows]
    category_map = (
        {
            c.id: c
            for c in list(
                (await db.execute(select(models.Category).where(models.Category.id.in_(category_ids)))).scalars()
            )
        }
        if category_ids
        else {}
    )

    return {
        "total_series_follows": total_series,
        "total_category_follows": total_categories,
        "top_series": [
            {
                "id": sid,
                "title": series_map[sid].title if sid in series_map else str(sid),
                "slug": series_map[sid].slug if sid in series_map else "",
                "count": count,
            }
            for sid, count in series_rows
        ],
        "top_categories": [
            {
                "id": cid,
                "name": category_map[cid].name if cid in category_map else str(cid),
                "count": count,
            }
            for cid, count in category_rows
        ],
    }
