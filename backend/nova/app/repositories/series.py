"""Series CRUD and episode ordering."""

from __future__ import annotations

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import models, schemas
from app.cache import (
    clear_posts_list_cache,
    clear_series_cache,
)

from ._base import _populate_post_metrics, utc_now_naive
from .posts import record_slug_redirect


async def get_series(db: AsyncSession, series_id: int) -> models.Series | None:
    """Fetch a series by id."""
    return (await db.execute(select(models.Series).where(models.Series.id == series_id))).scalars().first()


async def get_series_by_slug(db: AsyncSession, slug: str) -> models.Series | None:
    """Fetch a series by its unique, stable slug."""
    return (await db.execute(select(models.Series).where(models.Series.slug == slug))).scalars().first()


async def list_series(db: AsyncSession) -> list[models.Series]:
    """All series, ordered by title for a stable, predictable admin/public list."""
    return list((await db.execute(select(models.Series).order_by(models.Series.title))).scalars())


async def visible_series_post_counts(db: AsyncSession) -> dict[int, int]:
    """Map series_id -> count of publicly visible posts (drafts/scheduled
    excluded), for ALL series in one grouped query. The public series list
    used a per-series count query (N+1 on an uncached public endpoint — one
    count per series on every anonymous hit, RIL ISS-292)."""
    now = utc_now_naive()
    rows = (
        await db.execute(
            select(models.Post.series_id, func.count(models.Post.id))
            .where(
                models.Post.series_id.isnot(None),
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            )
            .group_by(models.Post.series_id)
        )
    ).all()
    return {row[0]: row[1] for row in rows}


async def get_series_visible_posts(db: AsyncSession, series: models.Series) -> list[models.Post]:
    """Ordered, publicly visible posts of a series (self-controlled order).

    Order is ``series_order`` then ``id`` (see Series.posts relationship) so
    equal orders resolve deterministically to insertion order. Drafts and
    scheduled-future posts are excluded, mirroring the public post list filter.
    """
    now = utc_now_naive()
    posts = list(
        (
            await db.execute(
                select(models.Post)
                .where(
                    models.Post.series_id == series.id,
                    models.Post.published.is_(True),
                    or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
                )
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
                .order_by(models.Post.series_order, models.Post.id)
            )
        )
        .unique()
        .scalars()
    )
    await _populate_post_metrics(db, posts)
    return posts


async def list_series_episodes(db: AsyncSession, series: models.Series) -> list[models.Post]:
    """All of a series' posts in order (admin view, any status incl. drafts).

    Order is ``series_order`` then ``id`` so equal orders resolve to insertion
    order (mirrors get_series_visible_posts).
    """
    return list(
        (
            await db.execute(
                select(models.Post)
                .where(models.Post.series_id == series.id)
                .order_by(models.Post.series_order, models.Post.id)
            )
        ).scalars()
    )


async def reorder_series_episodes(db: AsyncSession, series: models.Series, post_ids: list[int]) -> list[models.Post]:
    """Rewrite a series' episode order (1..n) from an explicit post-id list.

    Every id in ``post_ids`` must belong to the series, and the list must not
    contain duplicates, or a ValueError is raised before any write. Posts not
    listed keep their current series_order (they drop out of the ordered view
    only if no longer linked to the series). Returns the updated ordered posts.
    """
    if len(post_ids) != len(set(post_ids)):
        raise ValueError("Duplicate post ids in reorder")
    posts = []
    for pid in post_ids:
        post = await db.get(models.Post, pid)
        if post is None or post.series_id != series.id:
            raise ValueError(f"Post {pid} is not part of this series")
        posts.append(post)
    for index, post in enumerate(posts):
        post.series_order = index + 1
    await db.commit()
    for post in posts:
        await db.refresh(post)
    return posts


async def series_post_count(db: AsyncSession, series_id: int) -> int:
    """Total posts linked to a series (any status), for the admin episode view."""
    stmt = select(models.Post).where(models.Post.series_id == series_id)
    return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0


async def create_series(db: AsyncSession, data: schemas.SeriesCreate) -> models.Series:
    """Create a series. Raises ValueError on a duplicate slug."""
    db_series = models.Series(
        title=data.title,
        slug=data.slug,
        description=data.description,
    )
    db.add(db_series)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Series with slug '{data.slug}' already exists")
    await db.refresh(db_series)
    # The sitemap now lists series (DEC-318), so a create must bust the
    # rendered feeds too — clear_posts_list_cache is the superset that also
    # clears series_cache, matching update_series/delete_series.
    clear_posts_list_cache()
    return db_series


async def update_series(db: AsyncSession, series_id: int, data: schemas.SeriesUpdate) -> models.Series | None:
    """Update a series (title/slug/description). None if the series is missing."""
    db_series = await get_series(db, series_id)
    if not db_series:
        return None
    update_data = data.model_dump(exclude_unset=True)
    if "slug" in update_data and update_data["slug"] != db_series.slug:
        # Slug-change redirect (round 350): an old series URL that was shared/
        # indexed must keep pointing at this series after the rename.
        await record_slug_redirect(db, "series", db_series.slug, update_data["slug"])
    for field, value in update_data.items():
        setattr(db_series, field, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Series with slug '{data.slug}' already exists")
    await db.refresh(db_series)
    clear_series_cache()
    # Series identity is embedded in public post lists/feeds via SeriesBrief.
    clear_posts_list_cache()
    return db_series


async def delete_series(db: AsyncSession, series_id: int) -> bool:
    """Delete a series, unlinking its posts (posts keep existing, series cleared)."""
    db_series = await get_series(db, series_id)
    if not db_series:
        return False
    # Unlink posts first so the FK can't block the delete (no cascade on the
    # posts.series_id relation — deleting a series must never delete posts).
    await db.execute(
        update(models.Post)
        .where(models.Post.series_id == series_id)
        .values({models.Post.series_id: None, models.Post.series_order: 0})
    )
    # SeriesFollow is an additive DEC-009 table with no ORM cascade from
    # Series: purge the follow rows too, or a deleted series leaves stale
    # follows that, on SQLite autoincrement id reuse, re-point at an unrelated
    # later series (same orphan class as category/tag follows — deep-dive
    # finding).
    await db.execute(delete(models.SeriesFollow).where(models.SeriesFollow.series_id == series_id))
    await db.delete(db_series)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete series: it has dependent records")
    clear_series_cache()
    clear_posts_list_cache()
    return True
