"""Admin dashboard analytics stats (views, trends, comment activity)."""

from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models

from ._base import utc_now_naive


async def get_daily_views_stats(db: AsyncSession, days: int = 30) -> dict:
    """Reading-trend series + in-period top posts for the admin dashboard (DEC-086).

    ``series`` is every calendar day in [today-days+1, today] with its total
    views (zero-filled so the chart is a continuous axis). ``top_posts`` is the
    top 5 posts by in-period views (title/slug for deep links). The table only
    tracks forward from when the feature shipped — no backfill of the historic
    counter (honest, documented).
    """
    today = utc_now_naive().date()
    first = today - timedelta(days=days - 1)

    rows = (
        await db.execute(
            select(models.PostViewsDaily.day, func.sum(models.PostViewsDaily.views))
            .where(models.PostViewsDaily.day >= first)
            .group_by(models.PostViewsDaily.day)
        )
    ).all()
    by_day = {day: int(total) for day, total in rows}
    day = first
    series = []
    while day <= today:
        series.append({"day": day.isoformat(), "views": by_day.get(day, 0)})
        day += timedelta(days=1)

    top = (
        await db.execute(
            select(
                models.Post.id,
                models.Post.title,
                models.Post.slug,
                func.coalesce(func.sum(models.PostViewsDaily.views), 0).label("views"),
            )
            .join(models.PostViewsDaily, models.PostViewsDaily.post_id == models.Post.id)
            .where(models.PostViewsDaily.day >= first)
            .group_by(models.Post.id, models.Post.title, models.Post.slug)
            .order_by(func.sum(models.PostViewsDaily.views).desc())
            .limit(5)
        )
    ).all()

    return {
        "days": days,
        "total": sum(by_day.values()),
        "series": series,
        "top_posts": [{"id": row[0], "title": row[1], "slug": row[2], "views": int(row[3])} for row in top],
    }


async def get_post_views_trend(db: AsyncSession, post_id: int, days: int = 30) -> dict:
    """Per-post daily reading series for the admin post editor (DEC-287/TASK-372).

    Same zero-filled calendar axis as :func:`get_daily_views_stats`, but scoped
    to a single post, so the operator sees whether that post is gaining or
    decaying readership (answer: keep promoting it / follow up / retire). Reads
    the same ``post_views_daily`` table (tracks forward only, no backfill).
    The caller is responsible for 404ing an unknown post.
    """
    today = utc_now_naive().date()
    first = today - timedelta(days=days - 1)

    rows = (
        await db.execute(
            select(models.PostViewsDaily.day, models.PostViewsDaily.views).where(
                models.PostViewsDaily.post_id == post_id,
                models.PostViewsDaily.day >= first,
            )
        )
    ).all()
    by_day = {day: int(views) for day, views in rows}
    day = first
    series = []
    while day <= today:
        series.append({"day": day.isoformat(), "views": by_day.get(day, 0)})
        day += timedelta(days=1)

    return {
        "post_id": post_id,
        "days": days,
        "total": sum(by_day.values()),
        "series": series,
    }


async def get_comment_activity_stats(db: AsyncSession, days: int = 30) -> dict:
    """Comment-activity series + in-period top posts for the admin dashboard (DEC-154/TASK-189).

    The engagement axis (distinct from views/searches/follows): per-day counts of
    approved, publicly visible comments plus the posts that draw the most
    discussion in the period. ``series`` is a zero-filled calendar-axis.
    """
    today = utc_now_naive().date()
    first = today - timedelta(days=days - 1)
    # Naive-UTC datetime bounds for the filtered range. Comparing against the
    # real timestamp (not `date(created_at) >= 'YYYY-MM-DD'` string comparison)
    # is portable: PG has no `date >= text` operator (SQLite silently coerces).
    first_dt = datetime(first.year, first.month, first.day)
    end_dt = datetime(
        (today + timedelta(days=1)).year, (today + timedelta(days=1)).month, (today + timedelta(days=1)).day
    )

    rows = (
        await db.execute(
            select(func.date(models.Comment.created_at).label("day"), func.count(models.Comment.id))
            .where(
                models.Comment.is_approved.is_(True),
                models.Comment.created_at >= first_dt,
                models.Comment.created_at < end_dt,
            )
            .group_by(func.date(models.Comment.created_at))
        )
    ).all()
    by_day = {str(day): int(count) for day, count in rows}
    day = first
    series = []
    while day <= today:
        series.append({"day": day.isoformat(), "count": by_day.get(day.isoformat(), 0)})
        day += timedelta(days=1)

    top = (
        await db.execute(
            select(models.Post.id, models.Post.title, models.Post.slug, func.count(models.Comment.id))
            .join(models.Comment, models.Comment.post_id == models.Post.id)
            .where(
                models.Comment.is_approved.is_(True),
                models.Comment.created_at >= first_dt,
                models.Comment.created_at < end_dt,
            )
            .group_by(models.Post.id, models.Post.title, models.Post.slug)
            .order_by(func.count(models.Comment.id).desc())
            .limit(5)
        )
    ).all()

    # Authoritative pending-queue count for the dashboard (DEC-154/TASK-189,
    # round 276): this admin-scoped endpoint is where the moderation backlog
    # belongs, mirroring the non-leak posture everywhere else. The public
    # /api/stats previously exposed the same count to anonymous visitors (a
    # moderation-state oracle) so the public field was dropped (ISS-396/404).
    pending_count = (
        (
            await db.execute(
                select(func.count(models.Comment.id)).where(
                    models.Comment.is_approved == False,  # noqa: E712
                    models.Comment.reviewed_at.is_(None),
                )
            )
        ).scalar()
        or 0
        or 0
    )

    return {
        "days": days,
        "total": sum(by_day.values()),
        "series": series,
        "top_posts": [{"id": pid, "title": title, "slug": slug, "count": int(c)} for pid, title, slug, c in top],
        "pending_count": int(pending_count),
    }
