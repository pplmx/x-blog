"""Reader reading history, stats, streak, export, and recommendations."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Any, cast

from sqlalchemy import delete, func, or_, select
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import auth, models, schemas

from ._base import (
    ACTIVITY_DAYS,
    CANDIDATE_SCAN_LIMIT,
    HISTORY_IMPORT_CLOCK_SKEW,
    _commit_reader_upsert,
    _effective_publish_col,
    _populate_post_metrics,
    effective_publish_ts,
    escape_like_pattern,
    is_publicly_visible,
    utc_now_naive,
)
from .bookmarks import list_reader_bookmarks, list_reader_post_likes_for_export
from .series import get_series_visible_posts


async def get_reading_history(db: AsyncSession, reader_id: int, post_id: int) -> models.ReadingHistory | None:
    """Return the reader's view-history row for a post, or None."""
    return (
        (
            await db.execute(
                select(models.ReadingHistory).where(
                    models.ReadingHistory.reader_id == reader_id,
                    models.ReadingHistory.post_id == post_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def record_reading_history(
    db: AsyncSession,
    reader_id: int,
    post_id: int,
    scroll_position: int | None = None,
    *,
    scroll_fraction: float | None = None,
) -> tuple[models.ReadingHistory, bool]:
    """Upsert a view into the reader's history; returns (row, created).

    Idempotent: recording the same post again refreshes ``viewed_at`` in place
    (moving it to the front of the newest-first list) instead of duplicating —
    a reader revisiting a post bumps it, mirroring read-trail semantics
    (DEC-116, TASK-170).

    ``scroll_position`` (per-post resume, DEC-167/TASK-200) and
    ``scroll_fraction`` (cross-viewport resume, DEC-346/TASK-399) are updated
    in place *only* when the caller passes an explicit value: a plain view
    (None) preserves whatever position was last saved, so reopening a post does
    not wipe the reader's place. ``0`` is meaningful (scrolled back to the very
    top) and clears the saved offset.
    """
    existing = await get_reading_history(db, reader_id, post_id)
    # Denormalized reading-time estimate (ISS-451): recomputed on every upsert
    # so it tracks the content the reader just saw, letting /me/history/stats
    # SUM it in SQL instead of fetching full post content per row.
    post = await db.get(models.Post, post_id)
    minutes = schemas.reading_minutes(post.content) if post else 1
    if existing:
        # Naive UTC (ISS-452): viewed_at is a naive-UTC DateTime column.
        existing.viewed_at = utc_now_naive()
        existing.reading_minutes = minutes
        if scroll_position is not None:
            existing.scroll_position = scroll_position
        if scroll_fraction is not None:
            existing.scroll_fraction = scroll_fraction
        db.add(existing)
        await db.commit()
        await db.refresh(existing)
        return existing, False
    row = models.ReadingHistory(
        reader_id=reader_id,
        post_id=post_id,
        viewed_at=utc_now_naive(),
        reading_minutes=minutes,
        scroll_position=scroll_position,
        scroll_fraction=scroll_fraction,
    )
    db.add(row)
    if await _commit_reader_upsert(db):
        await db.refresh(row)
        return row, True
    existing = await get_reading_history(db, reader_id, post_id)
    if existing:
        return existing, False
    raise RuntimeError("history insert lost the unique-key race but no row was found")


async def import_reader_history(
    db: AsyncSession,
    reader_id: int,
    items: list[tuple[str, datetime | None]],
) -> tuple[int, int]:
    """Bulk-merge a device-local reading trail into a reader's server history.

    Signing in switches the history source from the on-device localStorage
    trail to the server trail (DEC-116/TASK-170); without a migration the
    guest's reads silently vanish from the page (RIL ISS-386, TASK-303). This
    upserts by post slug: a public post absent from the server history is added
    with the guest's original ``viewed_at`` (falling back to now for
    timestamp-less legacy rows), while an already-present entry keeps the LATER
    of the two read instants — a cross-device sync must never move a read
    backwards. Unresolvable or non-public slugs are skipped (same
    draft/scheduled non-leak invariant as every other history read path).

    Duplicate slugs within one request fold to a single row carrying the newest
    read instant, so a malformed client cannot trip the unique
    (reader_id, post_id) constraint. Returns ``(imported, skipped)``.
    """
    if not items:
        return 0, 0

    # A fast-clock device can send a read timestamp years in the future; since
    # the merge only ever moves a read forward, that row would pin its post at
    # the top of history permanently (TASK-348/ISS-450). Bound each record's
    # instant to now before folding: a timestamp a small skew window beyond now
    # is kept as-is (a slightly-ahead but honest device), anything further is
    # clamped so ordering stays honest.
    now = utc_now_naive()
    future_cutoff = now + HISTORY_IMPORT_CLOCK_SKEW

    # Fold duplicates and normalize each record to its newest read instant.
    # A timestamp-less (legacy) record must never clobber a real timestamp seen
    # elsewhere in the same batch: folding it to None would import as "now" and
    # inflate the reader's streak/activity (round-292 deep-dive).
    by_slug: dict[str, datetime | None] = {}
    for slug, viewed_at in items:
        if viewed_at is not None and viewed_at > future_cutoff:
            viewed_at = now
        prev = by_slug.get(slug)
        if viewed_at is None:
            if prev is None:
                by_slug[slug] = None
            # else: keep the real timestamp we already folded
        elif prev is None or viewed_at > prev:
            by_slug[slug] = viewed_at

    # The merge is idempotent (existing rows are updated in place, racing rows
    # resolve as existing), so a lost unique-key race needs no special-casing —
    # on IntegrityError we roll back and re-run once, and the row the winner
    # committed is now found by the existing_by_post query, committing cleanly
    # instead of 500ing (RIL ISS-419/TASK-321; same retry contract as
    # _commit_reader_upsert).
    for _attempt in range(2):
        try:
            return await _import_reader_history_pass(db, reader_id, by_slug)
        except IntegrityError:
            await db.rollback()
    raise RuntimeError("history import lost the unique-key race twice")


async def _import_reader_history_pass(
    db: AsyncSession,
    reader_id: int,
    by_slug: dict[str, datetime | None],
) -> tuple[int, int]:
    """One idempotent merge pass over the folded slug set (see caller)."""
    slugs = list(by_slug)
    posts = list((await db.execute(select(models.Post).where(models.Post.slug.in_(slugs)))).scalars())
    by_slug_post = {p.slug: p for p in posts}
    resolved_ids = [p.id for p in posts if is_publicly_visible(p)]

    existing_by_post: dict[int, models.ReadingHistory] = {}
    if resolved_ids:
        existing_rows = list(
            (
                await db.execute(
                    select(models.ReadingHistory).where(
                        models.ReadingHistory.reader_id == reader_id,
                        models.ReadingHistory.post_id.in_(resolved_ids),
                    )
                )
            ).scalars()
        )
        existing_by_post = {row.post_id: row for row in existing_rows}

    imported = 0
    skipped = 0
    for slug, viewed_at in by_slug.items():
        post = by_slug_post.get(slug)
        if post is None or not is_publicly_visible(post):
            skipped += 1
            continue
        row = existing_by_post.get(post.id)
        if row is not None:
            if viewed_at is not None and (row.viewed_at is None or viewed_at > row.viewed_at):
                row.viewed_at = viewed_at
                # The reader re-saw the post (and possibly its edited content):
                # refresh the denormalized estimate like record_reading_history
                # does (ISS-451).
                row.reading_minutes = schemas.reading_minutes(post.content)
                db.add(row)
            imported += 1
            continue
        db.add(
            models.ReadingHistory(
                reader_id=reader_id,
                post_id=post.id,
                viewed_at=viewed_at or utc_now_naive(),
                reading_minutes=schemas.reading_minutes(post.content),
            )
        )
        imported += 1
    await db.commit()
    return imported, skipped


async def list_reader_history(
    db: AsyncSession, reader_id: int, page: int = 1, limit: int = 20, q: str | None = None
) -> tuple[list[tuple[models.Post, datetime]], int]:
    """Return the reader's viewed posts (publicly visible only) newest-first.

    ``q`` (optional) filters to viewed posts whose title or excerpt matches the
    term (case-insensitive, escape-aware — DEC-148/TASK-186) so a reader can
    recall a past read.

    Paginated. Same non-leak invariant as bookmarks/subscriptions: a viewed post
    that was later un-published/scheduled simply stops appearing (the history row
    is kept; it reappears if the post becomes public again). Each item carries
    the post plus the last ``viewed_at`` so the UI can render when it was read.
    Visibility filtering, counting, and pagination all run in SQL so response
    cost is bounded by the requested page size.
    """
    filters = [
        models.ReadingHistory.reader_id == reader_id,
        models.ReadingHistory.viewed_at.is_not(None),
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= utc_now_naive()),
    ]
    if q and q.strip():
        term = f"%{escape_like_pattern(q.strip())}%"
        filters.append(
            or_(
                models.Post.title.ilike(term, escape="\\"),
                models.Post.excerpt.ilike(term, escape="\\"),
            )
        )

    total = int(
        (
            await db.execute(
                select(func.count(models.ReadingHistory.id))
                .join(models.Post, models.ReadingHistory.post_id == models.Post.id)
                .where(*filters)
            )
        ).scalar()
        or 0
    )
    query = (
        select(models.Post, models.ReadingHistory.viewed_at)
        .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
        .where(*filters)
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
    )
    rows = (
        (
            await db.execute(
                query.order_by(models.ReadingHistory.viewed_at.desc(), models.ReadingHistory.post_id.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        )
        .unique()
        .all()
    )
    page_items = []
    for post, viewed_at in rows:
        assert viewed_at is not None  # Enforced by the SQL filter above.
        page_items.append((post, viewed_at))
    return page_items, total


async def list_reader_in_progress(
    db: AsyncSession, reader_id: int, limit: int = 6
) -> tuple[list[tuple[models.Post, datetime]], int]:
    """The reader's posts with a saved resume position, newest-first (DEC-348,
    TASK-400).

    Feeds the home "Continue reading" row: the cross-device SERVER trail
    (``ReadingHistory.scroll_position``, DEC-167; ``scroll_fraction`` DEC-346)
    surfaced outside /history — the existing home row is a localStorage-only
    trail (DEC-104), so a signed-in reader on a new device sees nothing of what
    they left. "In progress" = a saved, POSITIVE position: plain views (no
    position saved) and rows cleared back to the top (0) are not. Same non-leak
    invariant as the list: a post that went dark stops appearing (row kept).
    Returns ``(rows, total)`` like ``list_reader_history``; ``limit`` bounds the
    home slice (the list endpoint is the paginated browse surface).
    """
    filters = [
        models.ReadingHistory.reader_id == reader_id,
        models.ReadingHistory.viewed_at.is_not(None),
        models.ReadingHistory.scroll_position.is_not(None),
        models.ReadingHistory.scroll_position > 0,
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= utc_now_naive()),
    ]
    total = int(
        (
            await db.execute(
                select(func.count(models.ReadingHistory.id))
                .join(models.Post, models.ReadingHistory.post_id == models.Post.id)
                .where(*filters)
            )
        ).scalar()
        or 0
    )
    rows = (
        (
            await db.execute(
                select(models.Post, models.ReadingHistory.viewed_at)
                .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
                .where(*filters)
                .options(joinedload(models.Post.category), joinedload(models.Post.tags))
                .order_by(models.ReadingHistory.viewed_at.desc(), models.ReadingHistory.post_id.desc())
                .limit(limit)
            )
        )
        .unique()
        .all()
    )
    return [(post, viewed_at) for post, viewed_at in rows if viewed_at is not None], total


async def clear_reader_history(db: AsyncSession, reader_id: int) -> int:
    """Delete every history row for a reader; returns the number removed."""
    deleted = cast(
        CursorResult[Any],
        await db.execute(delete(models.ReadingHistory).where(models.ReadingHistory.reader_id == reader_id)),
    ).rowcount
    await db.commit()
    return deleted


def _local_today(tz: tzinfo | None) -> date:
    """Today's calendar date in the reader's zone (UTC when ``tz`` is absent).

    The streak and heatmap are anchored to the reader's own calendar so a
    non-UTC reader sees "today" where their wall clock says today (DEC-316).
    """
    now_utc = datetime.now(UTC)
    return now_utc.date() if tz is None else now_utc.astimezone(tz).date()


def _read_local_date(viewed_at: datetime, tz: tzinfo | None) -> date:
    """The calendar date a read falls on in the reader's zone (DEC-316).

    ``viewed_at`` is stored as naive UTC (the naive-UTC wire contract); when no
    ``tz`` is supplied the UTC calendar date is the answer (the legacy
    behavior). Otherwise the instant is re-anchored in the reader's zone so
    the streak and heatmap agree with their own calendar. ``tzinfo`` is
    attached rather than assumed, so an already-aware timestamp converts
    correctly instead of being relabelled.
    """
    if tz is None:
        return viewed_at.date()
    aware = viewed_at if viewed_at.tzinfo is not None else viewed_at.replace(tzinfo=UTC)
    return aware.astimezone(tz).date()


def _current_streak(dates: set, *, today: date) -> int:
    """Consecutive active days ending ``today`` (or yesterday while today is
    still inactive — a reader who has not read *yet* today keeps their
    streak). ``today`` is the caller's calendar anchor: local when the stats
    request carried a timezone, UTC otherwise (DEC-316)."""
    if not dates:
        return 0
    anchor = today if today in dates else today - timedelta(days=1)
    n = 0
    while anchor in dates:
        n += 1
        anchor -= timedelta(days=1)
    return n


def _longest_streak(dates: set) -> int:
    """Longest run of consecutive active days anywhere in the history."""
    if not dates:
        return 0
    longest = run = 0
    prev = None
    for d in sorted(dates):
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        longest = max(longest, run)
        prev = d
    return longest


def _day_activity(counts: dict, *, today: date) -> list[dict]:
    """Per-day read counts for the last ``ACTIVITY_DAYS`` days ending ``today``
    (ascending, zeros included) for a GitHub-style heatmap. ``today`` is the
    caller's calendar anchor — local when the stats request carried a
    timezone, UTC otherwise (DEC-316)."""
    window_start = today - timedelta(days=ACTIVITY_DAYS - 1)
    out: list[dict] = []
    d = window_start
    while d <= today:
        out.append({"date": d.isoformat(), "count": counts.get(d, 0)})
        d += timedelta(days=1)
    return out


async def reader_history_stats(
    db: AsyncSession, reader_id: int, recent_limit: int = 6, *, tz: tzinfo | None = None
) -> dict:
    """Aggregate a reader's reading summary from their history (DEC-118).

    Returns total visible posts read, the sum of their reading minutes, the
    most-recent viewed timestamp, and the ``recent_limit`` most recent
    (post, viewed_at) pairs. Since DEC-169/TASK-201 it also returns the
    current/longest reading streak and a 52-week per-day activity list for the
    gamification surface on /history. Since DEC-316 the streak and activity are
    anchored to the reader's own calendar: ``tz`` (an IANA tzinfo) shifts each
    read and the "today" window to the reader's local date; without it the
    legacy UTC bucketing is used. Uses the same public-visibility filter as
    the history list so un-published posts don't leak or count.

    Cost (ISS-451): the summary used to scan the reader's ENTIRE history and
    materialize every post row — including `content` — to compute minutes in
    Python (multi-MB per pageview at scale). It now aggregates the denormalized
    ``reading_history.reading_minutes`` in SQL and only pulls narrow
    (viewed_at) timestamps for the streak/activity calendar, so no post content
    ever leaves the database here.
    """
    now = utc_now_naive()
    # Public-visibility filter pushed into SQL (was a per-object Python check):
    # published and, when scheduled, already published — matches
    # is_publicly_visible semantics so unpublished posts don't count or leak.
    visibility = [
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
    ]
    base = (
        select(models.ReadingHistory)
        .join(models.Post, models.Post.id == models.ReadingHistory.post_id)
        .where(models.ReadingHistory.reader_id == reader_id, *visibility)
    )
    _base_subq = base.subquery()

    # total_posts / total_reading_minutes / last_viewed_at: one aggregate row.
    # Aggregate over the subquery's OWN columns (subq.c.*) — referencing
    # models.ReadingHistory.* on an outer-select whose FROM is the subquery
    # makes SQLAlchemy cross-join reading_history again (cartesian product:
    # 3 posts -> count 9), RIL async migration.
    aggregate = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(_base_subq.c.reading_minutes), 0),
                func.max(_base_subq.c.viewed_at),
            ).select_from(_base_subq)
        )
    ).first()
    count, total_minutes, last_viewed_at = aggregate or (0, 0, None)
    total_posts = int(count or 0)
    total_minutes = int(total_minutes or 0)

    # Streak/activity calendar: narrow per-day read counts from the history
    # timestamps only (no post rows, no content).
    viewed_rows = (
        select(models.ReadingHistory.viewed_at)
        .join(models.Post, models.Post.id == models.ReadingHistory.post_id)
        .where(models.ReadingHistory.reader_id == reader_id, *visibility)
        .where(models.ReadingHistory.viewed_at.is_not(None))
    )
    today = _local_today(tz)
    counts: dict = {}
    dates: set = set()
    for (viewed_at,) in (await db.execute(viewed_rows)).all():
        d = _read_local_date(viewed_at, tz)
        counts[d] = counts.get(d, 0) + 1
        dates.add(d)

    # recent: bounded LIMIT with eager category/tags — the recent items are
    # serialized via ReadingHistoryItem.from_post which reads post.category and
    # post.tags, so without eager loading that's a lazy SELECT per recent row
    # (round-292 deep-dive).
    recent = (
        (
            await db.execute(
                select(models.Post, models.ReadingHistory.viewed_at)
                .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
                .where(models.ReadingHistory.reader_id == reader_id, *visibility)
                .options(joinedload(models.Post.category), joinedload(models.Post.tags))
                .order_by(models.ReadingHistory.viewed_at.desc(), models.Post.id.desc())
                .limit(recent_limit)
            )
        )
        .unique()
        .all()
    )

    return {
        "total_posts": total_posts,
        "total_reading_minutes": total_minutes,
        "last_viewed_at": last_viewed_at,
        "recent": recent,
        "current_streak": _current_streak(dates, today=today),
        "longest_streak": _longest_streak(dates),
        "activity": _day_activity(counts, today=today),
    }


async def reader_history_insights(db: AsyncSession, reader_id: int, top_categories: int = 5) -> dict:
    """Aggregate "what and how much" the reader has read (DEC-417/TASK-434).

    The streak/heatmap (reader_history_stats, DEC-316) show the calendar shape
    of reading; this adds the content shape: distinct publicly-visible posts
    read all-time, in the trailing 30 days, and the most-read categories (by
    distinct post count). One row per reader-post in ReadingHistory, so counts
    are per-post (repeat visits on the same post count once). Same
    public-visibility WHERE as list_reader_history so un-published/scheduled
    posts neither leak nor count.
    """
    now = utc_now_naive()
    since_30 = now - timedelta(days=30)
    visibility = [
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
    ]

    base = (
        select(models.Post)
        .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
        .where(models.ReadingHistory.reader_id == reader_id)
        .where(*visibility)
    )
    base = base.where(models.ReadingHistory.viewed_at.is_not(None))
    grand_total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    last_30_days = (
        await db.execute(
            select(func.count()).select_from(base.where(models.ReadingHistory.viewed_at >= since_30).subquery())
        )
    ).scalar() or 0

    cat_rows = (
        await db.execute(
            select(models.Category.name, func.count(models.Post.id))
            .select_from(models.ReadingHistory)
            .join(models.Post, models.Post.id == models.ReadingHistory.post_id)
            .join(models.Category, models.Category.id == models.Post.category_id)
            .where(
                models.ReadingHistory.reader_id == reader_id,
                models.ReadingHistory.viewed_at.is_not(None),
                *visibility,
            )
            .group_by(models.Category.id, models.Category.name)
            .order_by(func.count(models.Post.id).desc(), models.Category.name.asc())
            .limit(top_categories)
        )
    ).all()
    return {
        "grand_total": grand_total,
        "last_30_days": last_30_days,
        "top_categories": [{"name": name, "count": count} for name, count in cat_rows],
    }


async def reader_series_progress(db: AsyncSession, reader_id: int, series: models.Series) -> dict:
    """Compute a reader's progress through a series from their history.

    ``posts`` is the series' ordered, publicly visible posts (series_order then
    id). A post counts as read when it appears in the reader's reading_history
    (server-backed trail, TASK-170). Returns total count, the read post ids,
    how many are read, the first *unread* post slug (None when complete), and a
    completion flag. Public-visibility invariants hold via get_series_visible_posts.
    (DEC-122/TASK-173)
    """
    posts = await get_series_visible_posts(db, series)
    if not posts:
        return {
            "total": 0,
            "read_post_ids": [],
            "read_count": 0,
            "next_slug": None,
            "completed": False,
        }
    post_ids = [p.id for p in posts]
    read_rows = (
        await db.execute(
            select(models.ReadingHistory.post_id).where(
                models.ReadingHistory.reader_id == reader_id,
                models.ReadingHistory.post_id.in_(post_ids),
            )
        )
    ).all()
    read_ids = {row.post_id for row in read_rows}
    next_slug = next((p.slug for p in posts if p.id not in read_ids), None)
    return {
        "total": len(posts),
        "read_post_ids": sorted(p.id for p in posts if p.id in read_ids),
        "read_count": len(read_ids),
        "next_slug": next_slug,
        "completed": next_slug is None and len(posts) > 0,
    }


async def export_reader_data(db: AsyncSession, reader_id: int) -> dict:
    """Assemble a reader's portable data bundle (DEC-126/TASK-175).

    Scoped strictly to the caller: profile, public-visible bookmarks (with
    folder name), all of the reader's own comments (any moderation status),
    and their publicly-visible reading history. Nothing cross-reader and no
    draft/scheduled-post leakage — bookmarks/history exclude non-visible posts
    (same invariants as the read paths).
    """
    account = (await db.execute(select(auth.ReaderAccount).where(auth.ReaderAccount.id == reader_id))).scalars().first()
    account_data = {
        "email": account.email if account else None,
        "display_name": account.display_name if account else None,
        # Opt-in public liked-posts flag (round 360, DEC-393) — like the bio
        # it is the reader's own choice and belongs in their portable bundle.
        "public_likes": bool(account and account.public_likes),
        # Opt-in public bookmarks flag (round 363, DEC-399) — like public_likes
        # it is the reader's own privacy choice and belongs in their bundle.
        "public_bookmarks": bool(account and account.public_bookmarks),
        "created_at": account.created_at.isoformat() if account and account.created_at else None,
    }

    bookmarks = []
    # limit=None — a backup must be complete, never silently capped at the
    # list endpoint's default 100 bookmarks (RIL ISS-288).
    rows, _total = await list_reader_bookmarks(db, reader_id, limit=None)
    for post, _, folder_name, done in rows:
        bookmarks.append(
            {
                "post_id": post.id,
                "title": post.title,
                "slug": post.slug,
                "folder_name": folder_name,
                # Queue state (round 361, DEC-395): whether this save is marked
                # Done or still To-read.
                "done": bool(done),
                "created_at": post.created_at.isoformat() if post.created_at else None,
            }
        )

    comments = []
    comment_rows = list(
        (
            await db.execute(
                select(models.Comment).where(models.Comment.reader_id == reader_id).order_by(models.Comment.created_at)
            )
        ).scalars()
    )
    # One query for all parent posts, not one db.get per comment — a prolific
    # commenter's export was O(comments) round trips on an unbounded endpoint
    # (RIL ISS-282).
    post_by_id: dict[int, models.Post] = {}
    comment_post_ids = {c.post_id for c in comment_rows if c.post_id is not None}
    if comment_post_ids:
        post_by_id = {
            p.id: p
            for p in (await db.execute(select(models.Post).where(models.Post.id.in_(comment_post_ids)))).scalars().all()
        }
    for c in comment_rows:
        post = post_by_id.get(c.post_id)
        if c.is_approved is True:
            status = "approved"
        elif c.reviewed_at is not None:
            status = "rejected"
        else:
            status = "pending"
        comments.append(
            {
                "comment_id": c.id,
                "post_id": c.post_id,
                "post_slug": post.slug if post else None,
                "content": c.content,
                "status": status,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "edited_at": c.edited_at.isoformat() if c.edited_at else None,
            }
        )

    history = []
    history_rows = (
        await db.execute(
            select(models.Post, models.ReadingHistory.viewed_at)
            .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
            .where(models.ReadingHistory.reader_id == reader_id)
            .order_by(models.ReadingHistory.viewed_at.desc())
        )
    ).all()
    for post, viewed_at in history_rows:
        if not is_publicly_visible(post):
            continue
        history.append(
            {
                "post_id": post.id,
                "title": post.title,
                "slug": post.slug,
                "viewed_at": viewed_at.isoformat() if viewed_at else None,
            }
        )

    # Reader-owned follow rows (DEC-140/TASK-182, DEC-138/TASK-181,
    # DEC-195/TASK-215): the categories/tags/series this reader follows, with
    # the notify flag that couples a follow to push fan-out. Join names/slugs
    # in one query each so the bundle stays portable (a follow is dead weight
    # without the name of the thing followed).
    follows = {"categories": [], "tags": [], "series": []}
    cat_rows = (
        await db.execute(
            select(models.CategoryFollow, models.Category.name)
            .join(models.Category, models.CategoryFollow.category_id == models.Category.id)
            .where(models.CategoryFollow.reader_id == reader_id)
            .order_by(models.CategoryFollow.id)
        )
    ).all()
    follows["categories"] = [
        {"category_id": row.category_id, "name": name, "notify": row.notify} for row, name in cat_rows
    ]
    tag_rows = (
        await db.execute(
            select(models.TagFollow, models.Tag.name)
            .join(models.Tag, models.TagFollow.tag_id == models.Tag.id)
            .where(models.TagFollow.reader_id == reader_id)
            .order_by(models.TagFollow.id)
        )
    ).all()
    follows["tags"] = [{"tag_id": row.tag_id, "name": name, "notify": row.notify} for row, name in tag_rows]
    series_rows = (
        await db.execute(
            select(models.SeriesFollow, models.Series.title, models.Series.slug)
            .join(models.Series, models.SeriesFollow.series_id == models.Series.id)
            .where(models.SeriesFollow.reader_id == reader_id)
            .order_by(models.SeriesFollow.id)
        )
    ).all()
    follows["series"] = [
        {"series_id": row.series_id, "title": title, "slug": slug, "notify": row.notify}
        for row, title, slug in series_rows
    ]

    # Notification preferences (DEC-171/TASK-202, DEC-197/TASK-217): one row per
    # reader holding every push/inbox/email kind toggle. A missing row reads as
    # all-defaults — export None so the client can distinguish "no prefs set"
    # from explicit values.
    pref = (
        (
            await db.execute(
                select(models.ReaderNotificationPref).where(models.ReaderNotificationPref.reader_id == reader_id)
            )
        )
        .scalars()
        .first()
    )
    notification_prefs = (
        {
            "new_post": pref.new_post,
            "reply": pref.reply,
            "thread_comment": pref.thread_comment,
            "mention": pref.mention,
            "email_new_post": pref.email_new_post,
            "email_reply": pref.email_reply,
            "email_thread_comment": pref.email_thread_comment,
            "email_mention": pref.email_mention,
            "email_weekly_digest": pref.email_weekly_digest,
        }
        if pref is not None
        else None
    )

    # Durable inbox rows (DEC-160/TASK-192): the reader's own notification
    # history — kind, title, deep link, read state. No cross-reader data.
    notification_rows = list(
        (
            await db.execute(
                select(models.ReaderNotification)
                .where(models.ReaderNotification.reader_id == reader_id)
                .order_by(models.ReaderNotification.created_at)
            )
        ).scalars()
    )
    notifications = [
        {
            "notification_id": n.id,
            "kind": n.kind,
            "title": n.title,
            "body": n.body,
            "url": n.url,
            "read_at": (n.read_at.isoformat() if n.read_at else None),
            "created_at": (n.created_at.isoformat() if n.created_at else None),
        }
        for n in notification_rows
    ]

    # Push subscriptions (DEC-055/TASK-117): which browsers/endpoints this
    # reader registered. The endpoint + created_at identify the device;
    # p256dh/auth are the encryption keys and must NOT ride a data bundle
    # (same PII-adjacent bar as a comment's reply-notify token).
    push_rows = list(
        (
            await db.execute(
                select(models.PushSubscription)
                .where(models.PushSubscription.reader_id == reader_id)
                .order_by(models.PushSubscription.id)
            )
        ).scalars()
    )
    push_subscriptions = [
        {
            "endpoint": p.endpoint,
            "created_at": (p.created_at.isoformat() if p.created_at else None),
        }
        for p in push_rows
    ]

    return {
        "account": account_data,
        # Naive UTC, matching every other timestamp in the bundle (DEC-213):
        # an aware "+00:00" exported_at next to zone-less created_at/viewed_at
        # made a client that parses datetimes uniformly see mixed semantics.
        # (round 276 deep-dive)
        "exported_at": utc_now_naive().isoformat(),
        "bookmarks": bookmarks,
        # Liked posts (round 359/360): the durable reader likes now join the
        # bundle — publicly-visible only (same invariant as the /me/likes read
        # path), complete (never capped at the list default).
        "likes": [
            {
                "post_id": post.id,
                "title": post.title,
                "slug": post.slug,
                "liked_at": liked_at.isoformat() if liked_at else None,
            }
            for post, liked_at in await list_reader_post_likes_for_export(db, reader_id)
        ],
        "comments": comments,
        "history": history,
        "follows": follows,
        "notification_prefs": notification_prefs,
        "notifications": notifications,
        "push_subscriptions": push_subscriptions,
    }


async def recommend_posts(db: AsyncSession, reader_id: int, limit: int = 6) -> list[models.Post]:
    """Personalized post recommendations from the reader's interests.

    Interest signal = the reader's publicly-visible reading history (TASK-170)
    plus bookmarks (TASK-132): category and tag weights are the number of known
    posts carrying each. Candidate posts are public posts the reader has
    *not* read or bookmarked; each is scored by its shared category (×10) and
    shared tags (×2), then ranked by score desc, recency desc, id desc for a
    stable ordering. Posts with zero affinity are dropped. Only posts with
    affinity are recommended, so a cold-start reader gets an empty list (the
    frontend hides the row). (DEC-128/TASK-176)
    """
    now = utc_now_naive()

    history_ids = [
        r.post_id
        for r in (
            await db.execute(select(models.ReadingHistory.post_id).where(models.ReadingHistory.reader_id == reader_id))
        ).all()
    ]
    bookmark_ids = [
        b.post_id
        for b in (
            await db.execute(select(models.ReaderBookmark.post_id).where(models.ReaderBookmark.reader_id == reader_id))
        ).all()
    ]
    known_ids = set(history_ids) | set(bookmark_ids)

    # Build interest weights from the reader's known (public) posts.
    category_weight: dict[int, int] = {}
    tag_weight: dict[int, int] = {}
    if known_ids:
        known_posts = list(
            (
                await db.execute(
                    select(models.Post)
                    .where(models.Post.id.in_(list(known_ids)))
                    .options(joinedload(models.Post.category), joinedload(models.Post.tags))
                )
            )
            .unique()
            .scalars()
        )
        for post in known_posts:
            if not is_publicly_visible(post):
                continue
            if post.category_id:
                category_weight[post.category_id] = category_weight.get(post.category_id, 0) + 1
            for tag in post.tags:
                tag_weight[tag.id] = tag_weight.get(tag.id, 0) + 1
    if not category_weight and not tag_weight:
        return []

    # Bound the candidate scan: scoring runs in Python, so a retrieve-all would
    # materialize EVERY public post (incl. their 200KB+ content column) per
    # request — an O(all posts) load on an authenticated-triggerable endpoint
    # (round 278 perf finding). Cap the pool to the most-recent
    # CANDIDATE_SCAN_LIMIT posts (effective-publish desc — the same "when it
    # went live" line every other list uses), which keeps the heuristic's
    # quality identical on blogs under the cap while hard-bounding a
    # pathological install. Already-known posts are excluded before the cap.
    candidate_query = select(models.Post).where(
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
    )
    if known_ids:
        candidate_query = candidate_query.where(models.Post.id.notin_(list(known_ids)))
    candidates = list(
        (
            await db.execute(
                candidate_query.options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                    joinedload(models.Post.author),
                )
                .order_by(_effective_publish_col().desc(), models.Post.id.desc())
                .limit(CANDIDATE_SCAN_LIMIT)
            )
        )
        .unique()
        .scalars()
    )

    def affinity(post: models.Post) -> int:
        score = 0
        if post.category_id:
            score += category_weight.get(post.category_id, 0) * 10
        for tag in post.tags:
            score += tag_weight.get(tag.id, 0) * 2
        return score

    scored = [(affinity(p), p) for p in candidates if is_publicly_visible(p) and affinity(p) > 0]
    scored.sort(
        key=lambda item: (
            -item[0],
            # Recency is the effective publish time (publish_at ?? created_at),
            # the same "published when" line every other list surface uses —
            # ranking a June-scheduled post by its January draft date pushed it
            # below a later-drafted post published sooner (RIL ISS-283, ISS-265).
            -effective_publish_ts(item[1], fallback=now).timestamp(),
            -item[1].id,
        )
    )
    result = [post for _, post in scored[:limit]]
    await _populate_post_metrics(db, result)
    return result
