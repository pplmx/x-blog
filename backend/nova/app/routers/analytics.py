"""Admin reading-trend analytics (DEC-086, TASK-155).

The public /api/stats endpoint exposes aggregate totals; this endpoint serves
the per-day trend the dashboard charts — the last N days of total views plus
the top posts by in-period views. Admin-scoped (superuser or editor), because
readership signals are operationally useful to whoever moderates the blog.
The series advances on the write-on-read ``post_views_daily`` table from
DEC-086 and tracks forward only (no backfill of historic counters).
"""

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app import crud
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_READ, limiter

router = APIRouter(prefix="/api/admin/stats/views", tags=["stats"])

follows_router = APIRouter(prefix="/api/admin/stats/follows", tags=["stats"])


@router.get("")
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def views_trend(
    request: Request,  # noqa: ARG001
    days: int = Query(30, ge=1, le=365, description="number of days to include"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Last ``days`` days of total views + top posts by in-period views."""
    return crud.get_daily_views_stats(db, days=days)


@follows_router.get("")
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def follows_stats(
    request: Request,  # noqa: ARG001
    limit: int = Query(5, ge=1, le=50, description="top-N per axis"),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
    """Per-series + per-category reader follow counts and totals (DEC-144/TASK-184)."""
    return crud.get_follow_stats(db, limit=limit)
