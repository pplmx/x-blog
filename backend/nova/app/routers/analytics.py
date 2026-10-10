"""Admin reading-trend analytics (DEC-086, TASK-155).

The public /api/stats endpoint exposes aggregate totals; this endpoint serves
the per-day trend the dashboard charts — the last N days of total views plus
the top posts by in-period views. Admin-scoped (superuser or editor), because
readership signals are operationally useful to whoever moderates the blog.
The series advances on the write-on-read ``post_views_daily`` table from
DEC-086 and tracks forward only (no backfill of historic counters).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import models
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_READ, limiter
from app.schemas import IdInt
from app.services import analytics as analytics_service

router = APIRouter(prefix="/api/admin/stats/views", tags=["stats"])

follows_router = APIRouter(prefix="/api/admin/stats/follows", tags=["stats"])

searches_router = APIRouter(prefix="/api/admin/stats/searches", tags=["stats"])

comments_router = APIRouter(prefix="/api/admin/stats/comments", tags=["stats"])


@router.get("")
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
async def views_trend(
    request: Request,  # noqa: ARG001
    days: int = Query(30, ge=1, le=365, description="number of days to include"),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Last ``days`` days of total views + top posts by in-period views."""
    return await analytics_service.get_daily_views_stats(db, days=days)


@router.get("/posts/{post_id}")
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
async def post_views_trend(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    days: int = Query(30, ge=1, le=365, description="number of days to include"),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Per-post daily reading series for the post editor (DEC-287/TASK-372).

    The dashboard shows the aggregate trend; this endpoint narrows it to one
    post so the editor can render a per-post sparkline + period total. Same
    admin gate as the other stats endpoints. An unknown post is a 404.
    """
    result = await db.execute(select(models.Post).where(models.Post.id == post_id))
    post = result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return await analytics_service.get_post_views_trend(db, post_id, days=days)


@follows_router.get("")
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
async def follows_stats(
    request: Request,  # noqa: ARG001
    limit: int = Query(5, ge=1, le=50, description="top-N per axis"),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Per-series + per-category reader follow counts and totals (DEC-144/TASK-184)."""
    return await analytics_service.get_follow_stats(db, limit=limit)


@searches_router.get("")
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
async def top_searches(
    request: Request,  # noqa: ARG001
    limit: int = Query(10, ge=1, le=50, description="top-N search terms"),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Top public search terms by aggregate count (DEC-152/TASK-188)."""
    return await analytics_service.get_top_searches(db, limit=limit)


@comments_router.get("")
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
async def comments_stats(
    request: Request,  # noqa: ARG001
    days: int = Query(30, ge=1, le=365, description="number of days to include"),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Comment-activity series + top commented posts (DEC-154/TASK-189)."""
    return await analytics_service.get_comment_activity_stats(db, days=days)
