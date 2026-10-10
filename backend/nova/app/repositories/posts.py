"""Post CRUD, revisions, views/likes, and public post-list recommendations."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, cast

from sqlalchemy import case, delete, extract, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import auth, models, schemas
from app.cache import (
    clear_categories_cache,
    clear_counter_caches,
    clear_posts_list_cache,
    clear_tags_cache,
)
from app.emailer import (
    dispatch_newsletter_new_post,
)
from app.webpush import dispatch_new_post

from ._base import (
    _POST_CHILD_TABLES,
    MAX_REVISIONS_PER_POST,
    _bump_post_likes,
    _effective_publish_col,
    _populate_post_metrics,
    _reload_post_eager,
    is_publicly_visible,
    logger,
    utc_now_naive,
)
from .notifications import record_new_post_notifications


async def get_posts(
    db: AsyncSession,
    skip: int = 0,
    limit: int = 10,
    published: bool = True,
    category_id: int | None = None,
    tag_id: int | None = None,
    author_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    pinned_first: bool = True,
) -> tuple[list[models.Post], int]:
    query = select(models.Post)

    if published:
        now = utc_now_naive()
        query = query.where(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )

    if category_id:
        query = query.where(models.Post.category_id == category_id)

    if tag_id:
        query = query.join(models.Post.tags).where(models.Tag.id == tag_id).distinct()

    if author_id:
        query = query.where(models.Post.author_id == author_id)

    # Year/month filters key off the effective publish time, matching the
    # archive buckets and feed ordering — a scheduled post appears under the
    # month it actually went live, not the month it was drafted (RIL ISS-265).
    if year:
        query = query.where(extract("year", _effective_publish_col()) == year)
    if month:
        query = query.where(extract("month", _effective_publish_col()) == month)

    # Count before pagination
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0

    # Eager load relationships to avoid N+1 queries (series included: every
    # PostList payload serializes Post.series, and without the join a plain
    # lazy="select" fires a second query per row — up to `limit` extra
    # round-trips on every uncached list render, deep-dive finding).
    query = query.options(
        joinedload(models.Post.category),
        joinedload(models.Post.tags),
        joinedload(models.Post.series),
    )

    # Sort by pinned first (homepage/list emphasis — pinned is a UI-visibility
    # flag, so it leads the site's own listings), then by effective publish
    # time (a scheduled post reaches the top of the feed when it actually goes
    # live — previously a post drafted in January and published in June stayed
    # buried in January's position while its digest/SEO/feeds all reported
    # June, RIL ISS-265).
    # id desc is a deterministic tiebreak: a batch-scheduled post shares its
    # whole-second publish_at with others, and without it equal times would
    # resolve by query plan (joinedload here, bare column in adjacent) and
    # prev/next could disagree with this feed (round-234 review).
    # pinned_first=False drops the pinned column entirely for pure recency
    # channels (RSS/Atom/sitemap): an old pinned post must not float to item 0
    # and fake a freshly-updated feed when a poller keys off the first entry
    # (RIL ISS-474).
    # COALESCE pinned to False in the DESC sort: Post.pinned is nullable with
    # only a Python-side default, so a raw-SQL/COPY row can land a NULL, and
    # ORDER BY col DESC then puts NULLs FIRST on PostgreSQL but LAST on
    # SQLite — a NULL-pinned row would jump to the top of the public feed on
    # prod (same dialect-parity discipline as views/likes, TASK-535/ISS-614).
    order_cols = [
        func.coalesce(models.Post.pinned, False).desc(),
        _effective_publish_col().desc(),
        models.Post.id.desc(),
    ]
    if not pinned_first:
        order_cols = [_effective_publish_col().desc(), models.Post.id.desc()]
    posts = list((await db.execute(query.order_by(*order_cols).offset(skip).limit(limit))).unique().scalars())

    # Populate comment_count (approved) + reading_time in one pass (no N+1).
    await _populate_post_metrics(db, posts)
    return posts, total


async def get_archive(db: AsyncSession) -> list[tuple[int, int, int]]:
    """Group publicly-visible posts by (year, month) of their effective
    publish time (scheduled publish_at when set, else created_at).

    Returns rows ordered newest-first as (year, month, count). Only posts that
    are published and whose publish_at (if set) has passed are counted, so the
    archive index never reveals drafts or scheduled future posts. Grouping by
    effective publish time puts a scheduled post in the month it actually went
    live — previously it appeared under the month it was drafted, so a post
    published in June was invisible in June's archive (RIL ISS-265).
    """
    now = utc_now_naive()
    rows = (
        await db.execute(
            select(
                extract("year", _effective_publish_col()).label("year"),
                extract("month", _effective_publish_col()).label("month"),
                func.count(models.Post.id).label("count"),
            )
            .where(
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            )
            .group_by("year", "month")
            .order_by(
                extract("year", _effective_publish_col()).desc(),
                extract("month", _effective_publish_col()).desc(),
            )
        )
    ).all()
    # Positional Row access (year, month, count — the SELECT order): pyright
    # cannot resolve label attributes on an untyped SQLAlchemy Row, and
    # getattr() with a constant trips ruff B009.
    return [(int(r[0]), int(r[1]), int(r[2])) for r in rows]


async def get_post(db: AsyncSession, post_id: int) -> models.Post | None:
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


async def get_post_by_slug(db: AsyncSession, slug: str) -> models.Post | None:
    return (
        (
            await db.execute(
                select(models.Post)
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
                .where(models.Post.slug == slug)
            )
        )
        .unique()
        .scalars()
        .first()
    )


async def record_slug_redirect(db: AsyncSession, kind: str, old_slug: str, new_slug: str) -> None:
    """Capture an old slug -> new slug after a rename (round 350).

    The read routes use this to redirect old URLs to the current location. The
    map is kept acyclic and one-hop: any existing redirect that TARGETS the
    slug being renamed is retargeted at its new home (A->B joined with B->C
    becomes A->C), so an old link always resolves in exactly one hop no matter
    how many times the slug moved. No commit — the caller owns the transaction
    (the admin update that changed the slug commits right after).
    """
    if not old_slug or old_slug == new_slug:
        return
    # Chain collapse: redirects pointing AT the renamed slug now point at its
    # new home (B renames to C: the persisted A->B row becomes A->C). A
    # retarget that would point a row back at its own origin (renaming B back
    # to A makes A->B into the self-loop A->A) means the old slug's meaning was
    # superseded by the rename-back — the stale row is deleted rather than kept
    # (a kept self-loop, or an A->B + B->A pair, would loop a browser forever
    # once the entity is deleted or unpublished).
    for stale in list(
        (
            await db.execute(
                select(models.SlugRedirect).where(
                    models.SlugRedirect.kind == kind,
                    models.SlugRedirect.new_slug == old_slug,
                )
            )
        ).scalars()
    ):
        if stale.old_slug == new_slug:
            await db.delete(stale)
            continue
        stale.new_slug = new_slug
    # Upsert the direct rename, superseding any older redirect from this slug.
    row = (
        (
            await db.execute(
                select(models.SlugRedirect).where(
                    models.SlugRedirect.kind == kind, models.SlugRedirect.old_slug == old_slug
                )
            )
        )
        .scalars()
        .first()
    )
    if row is not None:
        row.new_slug = new_slug
    else:
        db.add(models.SlugRedirect(kind=kind, old_slug=old_slug, new_slug=new_slug))
    await db.flush()


async def resolve_slug_redirect(db: AsyncSession, kind: str, old_slug: str) -> str | None:
    """The current slug an old ``old_slug`` now lives at, or None (no redirect).

    A self-referential row (old_slug == new_slug) resolves to None: it can
    never forward anywhere useful, and redirecting a URL to itself would loop
    the browser. (Such a row can only exist if an old row survived a
    rename-back; live entities take precedence in the read routes anyway.)
    """
    row = (
        (
            await db.execute(
                select(models.SlugRedirect).where(
                    models.SlugRedirect.kind == kind, models.SlugRedirect.old_slug == old_slug
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None or row.new_slug == old_slug:
        return None
    return row.new_slug


async def create_post(db: AsyncSession, post: schemas.PostCreate, author_id: int | None = None) -> models.Post:
    category = None
    if post.category_id:
        category = (
            (await db.execute(select(models.Category).where(models.Category.id == post.category_id))).scalars().first()
        )
        if not category:
            raise ValueError(f"Category with id {post.category_id} not found")

    if post.series_id:
        series = (await db.execute(select(models.Series).where(models.Series.id == post.series_id))).scalars().first()
        if not series:
            raise ValueError(f"Series with id {post.series_id} not found")

    tags = []
    for tag_name in post.tags:
        tag = (await db.execute(select(models.Tag).where(models.Tag.name == tag_name))).scalars().first()
        if not tag:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            await db.flush()
        tags.append(tag)

    db_post = models.Post(
        title=post.title,
        slug=post.slug,
        content=post.content,
        excerpt=post.excerpt,
        published=post.published,
        pinned=post.pinned,
        comments_enabled=post.comments_enabled,
        publish_at=post.publish_at,
        category_id=post.category_id,
        series_id=post.series_id,
        series_order=post.series_order,
        cover_image=post.cover_image,
        author_id=author_id,
    )
    db_post.tags = tags
    db.add(db_post)
    try:
        # Flush once so db_post.id is available, then capture the initial
        # revision in the SAME transaction as the post, and commit once. A
        # single commit keeps the unit test that mocks commit/refresh valid
        # (clears the tags cache exactly once, no double-flush slug clash).
        await db.flush()
        await _snapshot_revision(db, db_post)
        await db.commit()
        await db.refresh(db_post)
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Slug '{post.slug}' already exists")
    except Exception:
        await db.rollback()
        raise

    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()

    # A post created as immediately visible is a new post — fan out the
    # new-post push (DEC-076, TASK-147). Best effort, no-op when unconfigured.
    # The exactly-once stamp (DEC-336, TASK-394) is set before dispatch so a
    # later fire-on-read sweep (maybe_notify_due_scheduled_posts) skips a post
    # that was already announced at write time — even a backdated publish_at
    # post that is visible the instant it is created must never double-fire.
    if is_publicly_visible(db_post):
        db_post.new_post_notified_at = utc_now_naive()
        await db.commit()
        # Re-load relationships inside the session loop before fan-out, which
        # reads post.tags/series, and response serialization — async lazy load
        # post-commit raises MissingGreenlet (RIL async migration).
        db_post = await _reload_post_eager(db, db_post.id) or db_post
        await record_new_post_notifications(db, db_post)
        await dispatch_new_post(db, db_post, logger)
        await dispatch_newsletter_new_post(db, db_post, logger)
    # Re-load relationships (tags/series/category) inside the session loop for
    # response serialization — async: post-commit lazy access raises
    # MissingGreenlet (RIL async migration).
    return await _reload_post_eager(db, db_post.id) or db_post


async def clone_post(db: AsyncSession, source: models.Post) -> models.Post:
    """Duplicate a post into a fresh draft (round 349).

    An editor running repeat-shaped content (weekly digests, release notes,
    episode templates) hand-copies the previous post for every sibling —
    tedious and error-prone. Clone copies the content-facing fields verbatim
    (title/content/excerpt/cover/category/tags/series membership + author
    attribution) into a NEW post, derives a unique ``{slug}-copy[-N]`` slug,
    and clears every publication-metadata field (published False, publish_at
    None, pinned False, zeroed views/likes) so the copy is a private draft
    that can neither leak nor announce itself. No comments/notifications are
    copied — a fresh draft has none.
    """
    base = source.slug
    slug = f"{base}-copy"
    n = 2
    while (await db.execute(select(models.Post).where(models.Post.slug == slug))).scalars().first():
        slug = f"{base}-copy-{n}"
        n += 1

    db_post = models.Post(
        title=source.title,
        slug=slug,
        content=source.content,
        excerpt=source.excerpt,
        published=False,
        pinned=False,
        publish_at=None,
        category_id=source.category_id,
        series_id=source.series_id,
        series_order=source.series_order,
        cover_image=source.cover_image,
        author_id=source.author_id,
        views=0,
        likes=0,
    )
    # Reuse the source's tag objects so the copy carries the same taxonomy
    # without creating shadow duplicates.
    db_post.tags = list(source.tags)
    db.add(db_post)
    try:
        # Same single-commit shape as create_post: flush for the id, snapshot
        # the initial revision in the same transaction, commit once.
        await db.flush()
        await _snapshot_revision(db, db_post)
        await db.commit()
        await db.refresh(db_post)
    except IntegrityError:
        await db.rollback()
        raise ValueError(f"Slug '{slug}' already exists")
    except Exception:
        await db.rollback()
        raise

    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()

    # The copy is always a draft — no new-post fan-out (unlike create_post,
    # which announces an immediately-visible post). Re-load relationships so
    # response serialization (tags/series/category) has them in-loop (async:
    # post-commit lazy access raises MissingGreenlet, RIL async migration).
    return await _reload_post_eager(db, db_post.id) or db_post


async def update_post(db: AsyncSession, post_id: int, post: schemas.PostUpdate) -> models.Post | None:
    db_post = await get_post(db, post_id)
    if not db_post:
        return None

    # Notify on the transition into visibility (draft/scheduled -> published),
    # not on every edit of an already-published post (DEC-076/TASK-147).
    was_visible = is_publicly_visible(db_post)
    update_data = post.model_dump(exclude_unset=True)

    if "category_id" in update_data and update_data["category_id"] is not None:
        category = (
            (await db.execute(select(models.Category).where(models.Category.id == update_data["category_id"])))
            .scalars()
            .first()
        )
        if not category:
            raise ValueError(f"Category with id {update_data['category_id']} not found")

    if "series_id" in update_data and update_data["series_id"] is not None:
        series = (
            (await db.execute(select(models.Series).where(models.Series.id == update_data["series_id"])))
            .scalars()
            .first()
        )
        if not series:
            raise ValueError(f"Series with id {update_data['series_id']} not found")

    if "author_id" in update_data and update_data["author_id"] is not None:
        # Author reassignment (DEC-359/TASK-405, TASK-479/ISS-555): an id that
        # no longer exists would serialize author: null, 404 the writer
        # archive/RSS and silently miss the author-follow fan-out — same
        # stale-id contract as category_id/series_id above.
        author = (await db.execute(select(auth.User).where(auth.User.id == update_data["author_id"]))).scalars().first()
        if not author:
            raise ValueError(f"Author with id {update_data['author_id']} not found")

    if "tag_ids" in update_data:
        tag_id_list = update_data.pop("tag_ids")
        tags = (
            list((await db.execute(select(models.Tag).where(models.Tag.id.in_(tag_id_list)))).scalars())
            if tag_id_list
            else []
        )
        if tag_id_list and len(tags) != len(tag_id_list):
            # Same unknown-id contract as the admin route (TASK-479/ISS-556):
            # a deleted/stale selection is an error, not a silent drop from the
            # editor's save.
            missing = [tid for tid in tag_id_list if tid not in {t.id for t in tags}]
            raise ValueError(f"Tag(s) with id {missing} not found")
        db_post.tags = tags

    if "slug" in update_data and update_data["slug"] != db_post.slug:
        # Slug-change redirect (round 350): an old URL that was shared/indexed
        # must keep pointing at this post after the rename.
        await record_slug_redirect(db, "post", db_post.slug, update_data["slug"])

    for field, value in update_data.items():
        setattr(db_post, field, value)

    try:
        # Capture the updated state as a new revision in the same transaction
        # as the field changes, then commit once (single-commit pattern).
        await _snapshot_revision(db, db_post)
        await db.commit()
        await db.refresh(db_post)
    except IntegrityError:
        await db.rollback()
        raise ValueError("Slug or unique constraint already exists")
    except Exception:
        await db.rollback()
        raise

    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()

    # Only the draft/scheduled -> published transition notifies (see above).
    # Stamp before dispatch (DEC-336, TASK-394) so the fire-on-read sweep
    # (maybe_notify_due_scheduled_posts) never re-announces this post — the
    # stamp is the exactly-once guard shared by both fan-out paths.
    if not was_visible and is_publicly_visible(db_post):
        db_post.new_post_notified_at = utc_now_naive()
        await db.commit()
        # Re-load relationships inside the session loop before fan-out, which
        # reads post.tags/series, and response serialization — async lazy load
        # post-commit raises MissingGreenlet (RIL async migration).
        db_post = await _reload_post_eager(db, db_post.id) or db_post
        await record_new_post_notifications(db, db_post)
        await dispatch_new_post(db, db_post, logger)
        await dispatch_newsletter_new_post(db, db_post, logger)
    # Re-load relationships (tags/series/category) inside the session loop for
    # response serialization — async: post-commit lazy access raises
    # MissingGreenlet (RIL async migration).
    return await _reload_post_eager(db, db_post.id) or db_post


async def capture_post_revision(db: AsyncSession, db_post: models.Post) -> None:
    """Snapshot the post's current state as a new revision and commit it.

    Public (not underscore-prefixed) because the admin PUT route applies edits
    in the router (it does not call ``crud.update_post``), so it must be able
    to invoke the same capture the crud paths use (DEC-158, TASK-191).
    """
    await _snapshot_revision(db, db_post)
    await db.commit()


async def _snapshot_revision(db: AsyncSession, db_post: models.Post) -> None:
    """Persist an immutable snapshot of the post's editable fields.

    Called on every admin create/update (and before a restore, so a restore is
    itself undo-able). Retention-capped per post so long auto-save sessions
    don't grow history without bound.
    """
    rev = models.PostRevision(
        post_id=db_post.id,
        title=db_post.title,
        slug=db_post.slug,
        content=db_post.content,
        excerpt=db_post.excerpt,
        cover_image=db_post.cover_image,
        category_id=db_post.category_id,
        series_id=db_post.series_id,
        series_order=db_post.series_order,
        publish_at=db_post.publish_at,
        pinned=bool(db_post.pinned),
        published=bool(db_post.published),
    )
    db.add(rev)
    await db.flush()
    await _prune_revisions(db, db_post.id)


async def _prune_revisions(db: AsyncSession, post_id: int) -> None:
    """Keep only the most recent MAX_REVISIONS_PER_POST revisions for a post."""
    total = (
        await db.execute(
            select(func.count()).select_from(
                select(models.PostRevision).where(models.PostRevision.post_id == post_id).subquery()
            )
        )
    ).scalar() or 0
    overflow = total - MAX_REVISIONS_PER_POST
    if overflow <= 0:
        return
    oldest = list(
        (
            await db.execute(
                select(models.PostRevision)
                .where(models.PostRevision.post_id == post_id)
                .order_by(models.PostRevision.id.asc())
                .limit(overflow)
            )
        ).scalars()
    )
    for rev in oldest:
        await db.delete(rev)


async def get_post_revisions(
    db: AsyncSession,
    post_id: int,
    limit: int = 100,
) -> list[models.PostRevision]:
    """Newest-first revision history for a post, bounded by ``limit``."""
    return list(
        (
            await db.execute(
                select(models.PostRevision)
                .where(models.PostRevision.post_id == post_id)
                .order_by(models.PostRevision.id.desc())
                .limit(limit)
            )
        ).scalars()
    )


async def get_post_revision(
    db: AsyncSession,
    post_id: int,
    revision_id: int,
) -> models.PostRevision | None:
    return (
        (
            await db.execute(
                select(models.PostRevision).where(
                    models.PostRevision.id == revision_id,
                    models.PostRevision.post_id == post_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def restore_post_revision(
    db: AsyncSession,
    post_id: int,
    revision_id: int,
) -> models.Post:
    """Apply a stored revision to the live post, snapshotting the current state
    first so the restore itself is part of the history (undo-able)."""
    db_post = await get_post(db, post_id)
    if not db_post:
        raise ValueError("Post not found")
    target = await get_post_revision(db, post_id, revision_id)
    if not target:
        raise ValueError("Revision not found")

    # Same draft/scheduled -> published transition rule as create/update: a
    # restore that makes the post publicly visible again (publish -> unpublish
    # -> undo via history) must re-fan-out the new-post inbox rows + Web Push.
    # Every other publish path fires it; restore was the silent miss, leaving
    # followers un-notified on a legitimate republish (RIL ISS-291).
    was_visible = is_publicly_visible(db_post)

    await _snapshot_revision(db, db_post)
    db_post.title = target.title
    db_post.slug = target.slug
    db_post.content = target.content
    db_post.excerpt = target.excerpt
    db_post.cover_image = target.cover_image
    db_post.category_id = target.category_id
    db_post.series_id = target.series_id
    db_post.series_order = target.series_order
    db_post.publish_at = target.publish_at
    db_post.pinned = bool(target.pinned)
    db_post.published = bool(target.published)
    try:
        await db.commit()
        await db.refresh(db_post)
    except IntegrityError:
        await db.rollback()
        raise ValueError("Slug or unique constraint already exists")
    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()

    if not was_visible and is_publicly_visible(db_post):
        # Exactly-once stamp (DEC-336/TASK-394), same as create/update: the
        # fire-on-read sweep must never re-announce a post the restore path
        # already announced.
        db_post.new_post_notified_at = utc_now_naive()
        await db.commit()
        await record_new_post_notifications(db, db_post)
        await dispatch_new_post(db, db_post, logger)
        await dispatch_newsletter_new_post(db, db_post, logger)
    return db_post


async def delete_post(db: AsyncSession, post_id: int) -> bool:
    db_post = await db.get(models.Post, post_id)
    if not db_post:
        return False
    # Dependent tables carry post_id as a plain integer with no DB-level FK and
    # no ORM cascade from Post (the DEC-009 additive-table convention, enforced
    # at the API layer) — delete them explicitly so a post delete never leaves
    # orphaned reader bookmarks / reading history / comment subscriptions /
    # per-day view rows behind (RIL ISS-296). Comments and revisions cascade
    # through Post.comments/Post.revisions, so they are not listed here.
    for model, _col in _POST_CHILD_TABLES:
        await db.execute(delete(model).where(_col == post_id))
    await db.delete(db_post)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete post: it has dependent records")
    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()
    return True


async def increment_views(db: AsyncSession, post_id: int) -> models.Post | None:
    """Increment the view count for a post using atomic SQL update.

    Also upserts today's row in ``post_views_daily`` (DEC-086) so the admin
    dashboard's reading-trend series advances on the same write-on-read path.
    One extra small statement per pageview rides the existing UPDATE+commit;
    coalescing these writes is tracked separately (TASK-026). The cached list
    payloads embed the view counter, so a pageview invalidates them (ISS-141).
    """
    # COALESCE the NULL out of the increment: Post.views is nullable with only
    # a Python-side default (a raw-SQL/COPY/legacy insert can land a NULL), and
    # NULL+1 is NULL on both SQLite and Postgres — the counter would stay null
    # forever and rank FIRST on Postgres (NULLS FIRST default for DESC) in the
    # popular list. Coalescing makes the increment dialect-parity (TASK-535).
    stmt = update(models.Post).where(models.Post.id == post_id).values(views=func.coalesce(models.Post.views, 0) + 1)
    await db.execute(stmt)
    # Atomic daily-row increment (round 276 deep-dive): the previous
    # SELECT-then-assign (`daily.views = (daily.views or 0) + 1`) raced — two
    # concurrent pageviews on the same post/day both read the same value, then
    # both wrote +1, silently dropping one increment from the admin dashboard's
    # reading-trend series (the IntegrityError fallback below only covered the
    # INSERT race on the unique row, not the UPDATE race). Mirror the atomic
    # UPDATE used for Post.views; insert (views=1) only when no row exists yet.
    today = utc_now_naive().date()
    # rowcount distinguishes "incremented an existing row" from "no row yet".
    # CursorResult is what Session.execute returns for DML; cast past the
    # generic Result[Any] typing (which has no rowcount) so pyright is quiet.
    daily_updated = cast(
        CursorResult[Any],
        await db.execute(
            update(models.PostViewsDaily)
            .where(
                models.PostViewsDaily.post_id == post_id,
                models.PostViewsDaily.day == today,
            )
            .values(views=models.PostViewsDaily.views + 1)
        ),
    )
    if daily_updated.rowcount == 0:
        db.add(models.PostViewsDaily(post_id=post_id, day=today, views=1))
    try:
        await db.commit()
    except IntegrityError:
        # Two concurrent first-view pageviews raced to insert the unique
        # uq_post_views_daily_post_day row (ISS-138): ours lost to the other
        # writer's commit. Re-apply both increments as plain atomic UPDATEs on
        # the now-visible rows, so the view is still counted and this request
        # does not 500 on the public view endpoint.
        await db.rollback()
        await db.execute(
            update(models.Post).where(models.Post.id == post_id).values(views=func.coalesce(models.Post.views, 0) + 1)
        )
        await db.execute(
            update(models.PostViewsDaily)
            .where(
                models.PostViewsDaily.post_id == post_id,
                models.PostViewsDaily.day == today,
            )
            .values(views=models.PostViewsDaily.views + 1)
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    # The cached list payloads embed the view counter — invalidate so a public
    # list never shows stale counts for up to the 5-min TTL (ISS-141). Only the
    # list cache needs to drop; the RSS/Atom/sitemap feeds and series details
    # don't carry views, so a pageview must not tear down the whole stack.
    clear_counter_caches()
    post = await _reload_post_eager(db, post_id)
    return post


async def increment_likes(db: AsyncSession, post_id: int) -> models.Post | None:
    """Increment the like count for a post using atomic SQL update.

    Invalidates the cached list payloads, which embed the like counter (ISS-141);
    feeds/series don't embed likes, so only the list cache is dropped.
    """
    await _bump_post_likes(db, post_id, 1)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    clear_counter_caches()
    post = await _reload_post_eager(db, post_id)
    return post


async def decrement_likes(db: AsyncSession, post_id: int) -> models.Post | None:
    """Decrement the like count for a post using atomic SQL update, floored at 0.

    The counter is a rough popularity badge (incrementable by guests too, so it
    is never an exact reader count); unlike must not tear it below zero. Same
    cache invalidation as increment_likes (the count is embedded in list
    payloads). Used by the reader unlike path (round 359) when a durable like
    row is actually removed.
    """
    await _bump_post_likes(db, post_id, -1)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    clear_counter_caches()
    post = await _reload_post_eager(db, post_id)
    return post


async def get_popular_posts(db: AsyncSession, limit: int = 5) -> list[models.Post]:
    """Get the most popular posts by view count."""
    now = utc_now_naive()
    posts = list(
        (
            await db.execute(
                select(models.Post)
                .where(
                    models.Post.published.is_(True),
                    or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
                )
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
                # COALESCE NULL views to 0 in the ORDER BY: Post.views is nullable
                # (Python-side default only), and Postgres ranks NULLs FIRST on DESC by
                # default — a raw/legacy NULL-counter row would top the popular list on
                # PG while SQLite (NULLS LAST) put it bottom. Coalescing makes the
                # ranking dialect-parity (TASK-535, mirrors increment_views).
                .order_by(func.coalesce(models.Post.views, 0).desc(), models.Post.id.desc())
                .limit(limit)
            )
        )
        .unique()
        .scalars()
    )
    await _populate_post_metrics(db, posts)
    return posts


async def get_trending_posts(db: AsyncSession, days: int = 7, limit: int = 5) -> list[models.Post]:
    """Public time-windowed top posts by in-window views (round 387, DEC-438).

    Fresh-content discovery for readers: unlike :func:`get_popular_posts`
    (all-time cumulative ``Post.views``), ranks by the sum of ``views`` over
    the last ``days`` days in the ``post_views_daily`` analytics table — a post
    that is new but already being read surfaces even though its cumulative
    count is small. Only published, effective-live posts qualify; each returned
    Post carries a transient ``views_window`` attribute (the in-window sum) for
    the response model. The table tracks forward only (no backfill), so a
    fresh install yields an empty list and the caller's section hides.
    """
    today = utc_now_naive().date()
    first = today - timedelta(days=days - 1)
    now = utc_now_naive()

    # In-window sums keyed by post_id (the same table admin analytics reads).
    daily = (
        select(
            models.PostViewsDaily.post_id,
            func.sum(models.PostViewsDaily.views).label("window_views"),
        )
        .where(models.PostViewsDaily.day >= first)
        .group_by(models.PostViewsDaily.post_id)
        .subquery()
    )

    rows = (
        (
            await db.execute(
                select(models.Post, daily.c.window_views)
                .join(daily, models.Post.id == daily.c.post_id)
                .where(
                    models.Post.published.is_(True),
                    or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
                )
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
                .order_by(daily.c.window_views.desc(), models.Post.id.desc())
                .limit(limit)
            )
        )
        .unique()
        .all()
    )
    posts = [p for p, _ in rows]
    await _populate_post_metrics(db, posts)
    for post, window_views in rows:
        # Transient attribute read by schemas.TrendingPost (from_attributes).
        post.views_window = int(window_views)
    return posts


async def get_related_posts(db: AsyncSession, post_id: int, limit: int = 5) -> list[models.Post]:
    """Get related posts based on category and tags.

    Uses SQL-based tag matching for better performance.
    """
    post = await get_post(db, post_id)
    if not post or not post.tags:
        # Fallback: just get recent posts in same category
        now = utc_now_naive()
        query = select(models.Post).where(
            models.Post.published.is_(True),
            models.Post.id != post_id,
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        if post and post.category_id:
            query = query.where(models.Post.category_id == post.category_id)
        posts = list(
            (
                await db.execute(
                    query.options(
                        joinedload(models.Post.category),
                        joinedload(models.Post.tags),
                        joinedload(models.Post.series),
                    )
                    .order_by(_effective_publish_col().desc(), models.Post.id.desc())
                    .limit(limit)
                )
            )
            .unique()
            .scalars()
        )
        await _populate_post_metrics(db, posts)
        return posts

    # Get tag IDs of the source post
    source_tag_ids = [t.id for t in post.tags]

    # SQL-based matching: find posts sharing tags, prioritize same category
    # Use a subquery to count matching tags

    # Access the post_tags table from models
    post_tags_table = models.post_tags

    tag_match_count_subq = (
        select(post_tags_table.c.post_id, func.count(post_tags_table.c.tag_id).label("match_count"))
        .where(post_tags_table.c.tag_id.in_(source_tag_ids))
        .group_by(post_tags_table.c.post_id)
        .subquery()
    )

    # Build main query with tag match count and eager loading
    now = utc_now_naive()
    query = (
        select(models.Post, tag_match_count_subq.c.match_count)
        .outerjoin(tag_match_count_subq, models.Post.id == tag_match_count_subq.c.post_id)
        .where(
            models.Post.published.is_(True),
            models.Post.id != post_id,
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
            joinedload(models.Post.series),
        )
    )

    # Same category gets higher priority (add 100 to match_count).
    # coalesce() turns NULL match counts into 0 so posts sharing no tags still
    # rank below same-category matches (PostgreSQL orders NULLs first in DESC
    # by default, which inverted the intended ranking).
    if post.category_id:
        query = query.add_columns(
            case(
                (
                    models.Post.category_id == post.category_id,
                    func.coalesce(tag_match_count_subq.c.match_count, 0) + 100,
                ),
                else_=func.coalesce(tag_match_count_subq.c.match_count, 0),
            ).label("priority")
        )
        query = query.order_by(
            case(
                (
                    models.Post.category_id == post.category_id,
                    func.coalesce(tag_match_count_subq.c.match_count, 0) + 100,
                ),
                else_=func.coalesce(tag_match_count_subq.c.match_count, 0),
            ).desc(),
            _effective_publish_col().desc(),
            # Deterministic on ties (equal priority + publish time), matching
            # get_posts' id tiebreak (RIL ISS-284).
            models.Post.id.desc(),
        )
    else:
        query = query.order_by(
            tag_match_count_subq.c.match_count.desc().nullslast(),
            _effective_publish_col().desc(),
            models.Post.id.desc(),
        )

    results = (await db.execute(query.limit(limit))).unique().all()

    # Extract posts from results (strip the extra columns)
    posts = [row[0] for row in results]
    await _populate_post_metrics(db, posts)
    return posts


async def get_adjacent_posts(db: AsyncSession, post_id: int) -> tuple[models.Post | None, models.Post | None]:
    """Return the linear previous/next posts around `post_id` in public feed order.

    Feed order is pinned desc, then effective publish time desc (publish_at ??
    created_at, matching ``get_posts`` — RIL ISS-265/267), so "previous" is the
    post immediately above the current one and "next" is the one immediately
    below it when scanning the homepage feed. Only publicly visible (published,
    publish_at passed) posts count, matching the feed.

    Returns ``(previous, next)``; either side is None at the ends of the feed,
    and both are None when the post is not publicly visible.
    """
    now = utc_now_naive()
    public_filter = (
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
    )
    # Rank every public post in exact feed order with a SQL window function,
    # then read only the current post's rank and its two neighbours. Ordering
    # MUST match get_posts (pinned, effective publish, id tiebreak) so a tie on
    # publish time never yields a prev/next that disagrees with the feed the
    # reader is scanning (round-234 review). Replaces the previous load-all-ids
    # O(n) scan (RIL ISS-295); the existing indexes serve the bounded query.
    ranked = (
        select(
            models.Post.id.label("post_id"),
            func.row_number()
            .over(
                order_by=(
                    # COALESCE pinned like get_posts (TASK-535 parity): a
                    # NULL-pinned row must rank with the unpinned group, not
                    # leap to rank 1 on PostgreSQL's NULLS-FIRST.
                    func.coalesce(models.Post.pinned, False).desc(),
                    _effective_publish_col().desc(),
                    models.Post.id.desc(),
                )
            )
            .label("rn"),
        )
        .where(public_filter[0], public_filter[1])
        .subquery()
    )
    my_rank = (await db.execute(select(ranked.c.rn).where(ranked.c.post_id == post_id))).scalar()
    if my_rank is None:
        return None, None

    neighbour_rows = (
        await db.execute(
            select(ranked.c.post_id, ranked.c.rn)
            .where(ranked.c.rn.between(my_rank - 1, my_rank + 1))
            .order_by(ranked.c.rn)
        )
    ).all()
    by_rn = {rn: post_id for post_id, rn in neighbour_rows}
    previous_id = by_rn.get(my_rank - 1)
    following_id = by_rn.get(my_rank + 1)
    if previous_id is None and following_id is None:
        return None, None

    rows = list(
        (
            await db.execute(
                select(models.Post)
                .where(models.Post.id.in_([pid for pid in (previous_id, following_id) if pid is not None]))
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
            )
        )
        .unique()
        .scalars()
    )
    by_id = {p.id: p for p in rows}
    await _populate_post_metrics(db, list(by_id.values()))
    previous = by_id.get(previous_id) if previous_id is not None else None
    following = by_id.get(following_id) if following_id is not None else None
    return previous, following
