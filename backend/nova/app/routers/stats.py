"""Statistics endpoint for blog metrics."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app import models
from app.crud import utc_now_naive
from app.database import get_db
from app.limiter import RATE_LIMIT_READ, limiter


class BlogStatsResponse(BaseModel):
    """Blog statistics response model."""

    total_posts: int
    published_posts: int
    # Posts that are published=True but whose publish_at is in the future: not
    # yet visible publicly, and distinct from drafts (published=False). Clients
    # that show a "drafts" bucket must subtract this, not just published_posts,
    # or scheduled posts silently masquerade as drafts. (RIL TASK-036)
    scheduled_posts: int
    total_categories: int
    total_tags: int
    total_comments: int
    pending_comments: int
    total_views: int


router = APIRouter(prefix="/api/stats", tags=["Stats"])


@router.get("", response_model=BlogStatsResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def get_blog_stats(request: Request, db: Session = Depends(get_db)):  # noqa: ARG001
    """Get blog statistics."""
    # Total posts
    total_posts = db.query(func.count(models.Post.id)).scalar() or 0

    # Published posts (scheduled posts only count once their publish_at has passed,
    # matching the public list semantics)
    now = utc_now_naive()
    published_posts = (
        db.query(func.count(models.Post.id))
        .filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .scalar()
        or 0
    )

    # Scheduled posts: published but publish_at is in the future (not yet live).
    # Mirrors the admin list's "scheduled" status filter semantics.
    scheduled_posts = (
        db.query(func.count(models.Post.id))
        .filter(
            models.Post.published.is_(True),
            models.Post.publish_at > now,
        )
        .scalar()
        or 0
    )

    # Total categories
    total_categories = db.query(func.count(models.Category.id)).scalar() or 0

    # Total tags
    total_tags = db.query(func.count(models.Tag.id)).scalar() or 0

    # Total comments
    total_comments = db.query(func.count(models.Comment.id)).scalar() or 0

    # Pending (unapproved) comments
    pending_comments = (
        db.query(func.count(models.Comment.id))
        .filter(
            models.Comment.is_approved == False  # noqa: E712
        )
        .scalar()
        or 0
    )

    # Total views
    total_views = db.query(func.sum(models.Post.views)).scalar() or 0

    return BlogStatsResponse(
        total_posts=total_posts,
        published_posts=published_posts,
        scheduled_posts=scheduled_posts,
        total_categories=total_categories,
        total_tags=total_tags,
        total_comments=total_comments,
        pending_comments=pending_comments,
        total_views=total_views,
    )
