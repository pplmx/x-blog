"""Tag CRUD with public post-count projection."""

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import models, schemas
from app.cache import (
    clear_posts_list_cache,
    clear_tags_cache,
    tags_cache,
)

from ._base import utc_now_naive


async def get_tags(db: AsyncSession) -> list[dict]:
    # Check cache first
    cache_key = "all_tags"
    if cache_key in tags_cache:
        return tags_cache[cache_key]

    # Query database
    tags = list((await db.execute(select(models.Tag))).scalars())

    # Post count per tag through the many-to-many join, one grouped query.
    # Counts only PUBLICLY VISIBLE posts (published + effective publish time
    # passed) — the grouped query must JOIN Post to apply the guard, otherwise
    # drafts/scheduled posts leak their existence into the unauthenticated
    # /api/tags payload and the count can never match what listing the tag
    # actually returns (deep-dive review, ISS-362; mirrors get_categories).
    now = utc_now_naive()
    rows = (
        await db.execute(
            select(models.post_tags.c.tag_id, func.count(models.post_tags.c.post_id))
            .join(models.Post, models.Post.id == models.post_tags.c.post_id)
            .where(
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            )
            .group_by(models.post_tags.c.tag_id)
        )
    ).all()
    counts = {tag_id: int(count) for tag_id, count in rows}

    # Cache plain dicts, not live ORM objects, so values survive across
    # per-request Sessions (invariant documented in cache.py). post_count is
    # not a column; it is computed and baked into the dict here.
    result = [{"id": tag.id, "name": tag.name, "post_count": counts.get(tag.id, 0)} for tag in tags]

    # Cache the result
    tags_cache[cache_key] = result
    return result


async def tag_visible_post_count(db: AsyncSession, tag_id: int) -> int:
    """Count of publicly visible posts with a tag (published + effective publish
    time passed), for the single-item /api/tags/{id} endpoint. Same rationale as
    category_visible_post_count: post_count is derived, and the item endpoint
    used to report 0 unconditionally (ISS-363)."""
    now = utc_now_naive()
    return (
        await db.execute(
            select(func.count(models.post_tags.c.post_id))
            .join(models.Post, models.Post.id == models.post_tags.c.post_id)
            .where(
                models.post_tags.c.tag_id == tag_id,
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            )
        )
    ).scalar() or 0


async def get_tag(db: AsyncSession, tag_id: int) -> models.Tag | None:
    return (await db.execute(select(models.Tag).where(models.Tag.id == tag_id))).scalars().first()


async def get_tag_by_name(db: AsyncSession, name: str) -> models.Tag | None:
    return (await db.execute(select(models.Tag).where(models.Tag.name == name))).scalars().first()


async def create_tag(db: AsyncSession, tag: schemas.TagCreate) -> models.Tag:
    db_tag = models.Tag(name=tag.name)
    db.add(db_tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Tag with name '{tag.name}' already exists")
    await db.refresh(db_tag)
    # Clear cache
    clear_tags_cache()
    return db_tag


async def update_tag(db: AsyncSession, tag_id: int, tag: schemas.TagCreate) -> models.Tag | None:
    db_tag = await get_tag(db, tag_id)
    if db_tag:
        db_tag.name = tag.name
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError(f"Tag with name '{tag.name}' already exists")
        await db.refresh(db_tag)
        # Clear cache — and the POSTS-list + feed caches too: PostList embeds
        # this tag's name and the sitemap renders it, so the rename must not
        # leave /api/posts cards and /sitemap.xml showing the old name until the
        # 5-min TTL (ISS-364; same rationale as update_category).
        clear_tags_cache()
        clear_posts_list_cache()
    return db_tag


async def delete_tag(db: AsyncSession, tag_id: int) -> bool:
    db_tag = await get_tag(db, tag_id)
    if db_tag:
        # Check for posts referencing this tag (proactive FK check)
        post_count = (
            await db.execute(
                select(func.count()).select_from(select(models.Post).where(models.Post.tags.any(id=tag_id)).subquery())
            )
        ).scalar() or 0
        if post_count > 0:
            raise ValueError("Cannot delete tag: it is referenced by posts")
        # TagFollow is an additive DEC-009 table with no ORM cascade from Tag:
        # purge the follow rows too, or a deleted tag leaves stale follows that,
        # on SQLite autoincrement id reuse, re-point at an unrelated later tag
        # (same orphan class as category follows + guest thread subs).
        await db.execute(delete(models.TagFollow).where(models.TagFollow.tag_id == tag_id))
        await db.delete(db_tag)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("Cannot delete tag: it is referenced by posts")
        # Clear cache
        clear_tags_cache()
        return True
    return False
