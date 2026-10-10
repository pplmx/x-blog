"""Category CRUD with public post-count projection."""

from __future__ import annotations

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import models, schemas
from app.cache import (
    categories_cache,
    clear_categories_cache,
    clear_posts_list_cache,
)

from ._base import utc_now_naive


async def get_categories(db: AsyncSession) -> list[dict]:
    # Check cache first
    cache_key = "all_categories"
    if cache_key in categories_cache:
        return categories_cache[cache_key]

    # Query database
    categories = list((await db.execute(select(models.Category))).scalars())

    # Post count per category in a single grouped query (no N+1). Counts only
    # PUBLICLY VISIBLE posts (published + effective publish time passed), the
    # same guard every public post-list path applies (compare
    # visible_series_post_counts) — the previous query counted drafts and
    # scheduled-future posts too, which (a) leaked their existence to
    # anonymous visitors on this unauthenticated endpoint and (b) reported
    # counts that could never match the posts actually listable under the
    # category (deep-dive review, ISS-362).
    now = utc_now_naive()
    rows = (
        await db.execute(
            select(models.Post.category_id, func.count(models.Post.id))
            .where(
                models.Post.category_id.isnot(None),
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            )
            .group_by(models.Post.category_id)
        )
    ).all()
    counts = {cat_id: int(count) for cat_id, count in rows}

    # Cache plain dicts, not live ORM objects, so values survive across
    # per-request Sessions (invariant documented in cache.py). post_count is
    # not a column; it is computed and baked into the dict here.
    result = [{"id": cat.id, "name": cat.name, "post_count": counts.get(cat.id, 0)} for cat in categories]

    # Cache the result
    categories_cache[cache_key] = result
    return result


async def category_visible_post_count(db: AsyncSession, category_id: int) -> int:
    """Count of publicly visible posts in a category (published + effective
    publish time passed), for the single-item /api/categories/{id} endpoint.
    get_categories computes the same number in one grouped query for the list
    payload; without it the item endpoint always reported post_count=0 because
    post_count is derived (not a column) and the schema defaulted (ISS-363)."""
    now = utc_now_naive()
    return (
        await db.execute(
            select(func.count(models.Post.id)).where(
                models.Post.category_id == category_id,
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            )
        )
    ).scalar() or 0


async def get_category(db: AsyncSession, category_id: int) -> models.Category | None:
    return (await db.execute(select(models.Category).where(models.Category.id == category_id))).scalars().first()


async def get_category_by_name(db: AsyncSession, name: str) -> models.Category | None:
    return (await db.execute(select(models.Category).where(models.Category.name == name))).scalars().first()


async def create_category(db: AsyncSession, category: schemas.CategoryCreate) -> models.Category:
    db_category = models.Category(name=category.name)
    db.add(db_category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Category with name '{category.name}' already exists")
    await db.refresh(db_category)
    # Clear cache
    clear_categories_cache()
    return db_category


async def update_category(
    db: AsyncSession, category_id: int, category: schemas.CategoryCreate
) -> models.Category | None:
    db_category = await get_category(db, category_id)
    if not db_category:
        return None
    db_category.name = category.name
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Category with name '{category.name}' already exists")
    await db.refresh(db_category)
    # Clear cache — and the POSTS-list + feed caches too: PostList embeds the
    # category's name and the sitemap/scoped feeds render it, so a rename that
    # only invalidated the enumeration cache left /api/posts cards and
    # /sitemap.xml serving the old name for up to the 5-min TTL (ISS-364).
    clear_categories_cache()
    clear_posts_list_cache()
    return db_category


async def delete_category(db: AsyncSession, category_id: int) -> bool:
    db_category = await get_category(db, category_id)
    if not db_category:
        return False
    # Check for posts referencing this category (proactive FK check)
    post_count = (
        await db.execute(
            select(func.count()).select_from(
                select(models.Post).where(models.Post.category_id == category_id).subquery()
            )
        )
    ).scalar() or 0
    if post_count > 0:
        raise ValueError("Cannot delete category: it is referenced by posts")
    # CategoryFollow is an additive DEC-009 table with no ORM cascade from
    # Category: purge the follow rows too, or a deleted category leaves stale
    # follows behind that, on SQLite autoincrement id reuse, re-point at an
    # unrelated later category (same orphan class as guest thread subs —
    # deep-dive finding).
    await db.execute(delete(models.CategoryFollow).where(models.CategoryFollow.category_id == category_id))
    await db.delete(db_category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete category: it is referenced by posts")
    # Clear cache
    clear_categories_cache()
    return True
