"""Full-blog backup snapshot and restore."""

from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import models
from app.cache import (
    clear_categories_cache,
    clear_posts_list_cache,
    clear_tags_cache,
)

from ._base import _from_iso, _iso, utc_now_naive


async def build_backup_snapshot(db: AsyncSession) -> dict:
    """Serialize the whole blog into a portable JSON snapshot (DEC-082).

    Content only: categories, tags, series, posts (with their category/tags/
    series links, view/like counters) and each post's comment threads, parents
    referenced by their export ordinal. Deliberately EXCLUDES auth data —
    admin users, reader accounts and their password hashes, browser push
    subscriptions — so a backup never carries a credential. Reader-attributed
    comments are exported with a ``reader`` marker; on restore they degrade to
    anonymous because reader accounts don't round-trip.
    """
    categories = [
        {"name": c.name}
        for c in list((await db.execute(select(models.Category).order_by(models.Category.name))).scalars())
    ]
    tags = [{"name": t.name} for t in list((await db.execute(select(models.Tag).order_by(models.Tag.name))).scalars())]
    series = [
        {"title": s.title, "slug": s.slug, "description": s.description}
        for s in list((await db.execute(select(models.Series).order_by(models.Series.slug))).scalars())
    ]
    posts_out: list[dict] = []
    for post in list(
        (
            await db.execute(
                select(models.Post)
                # category/series are read per row below (name/slug); eager-load them
                # with the joinedloads so a full-blog snapshot stays a handful of
                # queries, not 2 per post (RIL ISS-289).
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.series),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.comments),
                )
                .order_by(models.Post.slug)
            )
        )
        .unique()
        .scalars()
    ):
        comments = sorted(post.comments, key=lambda c: (c.created_at or datetime.min, c.id))
        ordinal_by_id = {c.id: i for i, c in enumerate(comments)}
        posts_out.append(
            {
                "slug": post.slug,
                "title": post.title,
                "content": post.content,
                "excerpt": post.excerpt,
                "published": bool(post.published),
                "pinned": bool(post.pinned),
                "publish_at": _iso(post.publish_at),
                "created_at": _iso(post.created_at),
                "updated_at": _iso(post.updated_at),
                "cover_image": post.cover_image,
                "views": post.views or 0,
                "likes": post.likes or 0,
                "category": post.category.name if post.category else None,
                "tags": [t.name for t in sorted(post.tags, key=lambda t: t.name)],
                "series": post.series.slug if post.series else None,
                "series_order": post.series_order,
                "comments": [
                    {
                        "import_key": f"{post.slug}#{i}",
                        "nickname": c.nickname,
                        "email": c.email,
                        "content": c.content,
                        "ip_address": c.ip_address,
                        "is_approved": bool(c.is_approved),
                        "reviewed_at": _iso(c.reviewed_at),
                        "created_at": _iso(c.created_at),
                        "parent_ordinal": (ordinal_by_id.get(c.parent_id) if c.parent_id is not None else None),
                        "reader": c.reader_id is not None,
                    }
                    for i, c in enumerate(comments)
                ],
            }
        )
    return {
        "format": "x-blog-backup",
        "version": 1,
        # Naive UTC, matching every other timestamp in the bundle (DEC-213):
        # an aware "+00:00" exported_at next to zone-less created_at/viewed_at
        # made a client that parses datetimes uniformly see mixed semantics.
        # (round 276 deep-dive)
        "exported_at": utc_now_naive().isoformat(),
        "categories": categories,
        "tags": tags,
        "series": series,
        "posts": posts_out,
    }


async def restore_backup(db: AsyncSession, payload: dict) -> dict:
    """Import an ``x-blog-backup`` snapshot via natural-key upserts (DEC-082).

    Categories/tags by name, series by slug, posts by slug (existing post:
    content fields are updated, comment threads merged under ``import_key``;
    unknown slug: created). Post tags are rebuilt to match the snapshot.
    Comments upsert on (post_id, import_key) so a second import of the same
    snapshot never duplicates them; parents are re-wired after pass 1 (children
    may precede their parent in the export). Reader-attributed comments restore
    as anonymous (reader accounts don't round-trip).

    Raises ``ValueError`` for an unrecognized format so the route can 422.
    """
    if payload.get("format") != "x-blog-backup" or payload.get("version") != 1:
        raise ValueError("Unsupported backup format (expected x-blog-backup v1)")
    counts = {
        "categories": 0,
        "tags": 0,
        "series": 0,
        "posts_created": 0,
        "posts_updated": 0,
        "comments_created": 0,
        "comments_skipped": 0,
    }

    # The whole import must COMMIT: get_db closes the session without committing
    # (a bare db.close() rolls back the pending transaction), so flush-only work
    # here silently persisted nothing in production even though the endpoint
    # returned 200 with created/updated counts (ISS-274). Every other write path
    # in crud.py commits explicitly for exactly this reason. A mid-import
    # exception rolls back so no half-imported state survives.
    restored_post_ids: set[int] = set()
    try:
        # Categories, tags, series — upsert by natural key, then flush so ids
        # exist for the post FK/relationship assignments below.
        cat_by_name = {c.name: c for c in list((await db.execute(select(models.Category))).scalars())}
        for item in payload.get("categories", []):
            name = (item.get("name") or "").strip()
            if not name or name in cat_by_name:
                continue
            cat_by_name[name] = models.Category(name=name)
            db.add(cat_by_name[name])
            counts["categories"] += 1

        tag_by_name = {t.name: t for t in list((await db.execute(select(models.Tag))).scalars())}
        for item in payload.get("tags", []):
            name = (item.get("name") or "").strip()
            if not name or name in tag_by_name:
                continue
            tag_by_name[name] = models.Tag(name=name)
            db.add(tag_by_name[name])
            counts["tags"] += 1

        series_by_slug = {s.slug: s for s in list((await db.execute(select(models.Series))).scalars())}
        for item in payload.get("series", []):
            slug = (item.get("slug") or "").strip()
            if not slug:
                continue
            series = series_by_slug.get(slug)
            if series is None:
                series = models.Series(slug=slug)
                db.add(series)
                series_by_slug[slug] = series
                counts["series"] += 1
            series.title = item.get("title") or series.title
            series.description = item.get("description")

        await db.flush()

        # Posts — upsert by slug; tags rebuilt; comments merged by import_key.
        post_by_slug = {
            p.slug: p
            for p in list(
                (await db.execute(select(models.Post).options(joinedload(models.Post.tags)))).unique().scalars()
            )
        }
        for item in payload.get("posts", []):
            slug = (item.get("slug") or "").strip()
            if not slug:
                continue
            post = post_by_slug.get(slug)
            if post is None:
                post = models.Post(slug=slug)
                db.add(post)
                post_by_slug[slug] = post
                counts["posts_created"] += 1
            else:
                counts["posts_updated"] += 1
            post.title = (item.get("title") or "Untitled")[:200]
            post.content = item.get("content") or ""
            post.excerpt = item.get("excerpt")
            post.published = bool(item.get("published", True))
            post.pinned = bool(item.get("pinned", False))
            post.publish_at = _from_iso(item.get("publish_at"))
            restored_created = _from_iso(item.get("created_at"))
            if restored_created is not None:
                post.created_at = restored_created
            post.cover_image = item.get("cover_image")
            post.views = int(item.get("views") or 0)
            post.likes = int(item.get("likes") or 0)
            restored_post_ids.add(post.id)
            category_name = item.get("category")
            post.category = cat_by_name.get(category_name) if category_name else None
            post.series = series_by_slug.get(item.get("series")) if item.get("series") else None
            post.series_order = int(item.get("series_order") or 0)
            post.tags = [tag_by_name[t] for t in (item.get("tags") or []) if t in tag_by_name]
            await db.flush()  # post.id (and ids it links) must exist for the comment pass

            new_by_ordinal: dict[int, models.Comment] = {}
            metas = item.get("comments") or []
            for ordinal, cmeta in enumerate(metas):
                key = cmeta.get("import_key")
                if key is not None:
                    existing = (
                        (
                            await db.execute(
                                select(models.Comment).where(
                                    models.Comment.import_key == key, models.Comment.post_id == post.id
                                )
                            )
                        )
                        .scalars()
                        .first()
                    )
                    if existing is not None:
                        new_by_ordinal[ordinal] = existing
                        counts["comments_skipped"] += 1
                        continue
                comment = models.Comment(
                    post_id=post.id,
                    nickname=(cmeta.get("nickname") or "")[:50],
                    email=cmeta.get("email"),
                    content=cmeta.get("content") or "",
                    ip_address=cmeta.get("ip_address"),
                    is_approved=bool(cmeta.get("is_approved", True)),
                    reviewed_at=_from_iso(cmeta.get("reviewed_at")),
                    created_at=_from_iso(cmeta.get("created_at")),
                    # Reader accounts don't round-trip (DEC-082): a reader-attributed
                    # comment restores as anonymous free-text.
                    import_key=key,
                )
                db.add(comment)
                new_by_ordinal[ordinal] = comment
                counts["comments_created"] += 1
            await db.flush()  # comment ids for parent re-wiring
            for ordinal, cmeta in enumerate(metas):
                parent_ordinal = cmeta.get("parent_ordinal")
                if parent_ordinal is not None and parent_ordinal in new_by_ordinal:
                    new_by_ordinal[ordinal].parent_id = new_by_ordinal[parent_ordinal].id

        # Restore rewinds each post's published views/likes counter to the
        # snapshot, but a backup carries NO per-day breakdown — so the pre-restore
        # post_views_daily rows from the live instance would keep summing into the
        # admin trend chart, permanently disagreeing with the restored counter
        # (re-restoring never fixes it; round-292 deep-dive ISS-463). Delete the
        # daily rows for every restored post in the same transaction: the trend
        # restarts from the restored counter and only tracks views forward, which
        # matches both the fresh-instance case (no rows) and the documented
        # "tracks forward only, no backfill" trend (DEC-086).
        if restored_post_ids:
            await db.execute(delete(models.PostViewsDaily).where(models.PostViewsDaily.post_id.in_(restored_post_ids)))
    except Exception:
        await db.rollback()
        raise

    await db.commit()
    # Restored content is live immediately, so every public cache the restore
    # could have changed must be invalidated: posts lists + feeds + series
    # (clear_posts_list_cache) and the category/tag enumeration (30-min TTL,
    # otherwise a newly-restored category/tag could stay invisible for half an
    # hour). Other write paths do exactly this; restore was the one bulk write
    # that left the public read surface serving pre-restore data (ISS-365).
    clear_posts_list_cache()
    clear_categories_cache()
    clear_tags_cache()
    return counts
