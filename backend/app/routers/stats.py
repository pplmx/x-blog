"""Statistics endpoint for blog metrics."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.database import get_db


class BlogStatsResponse(BaseModel):
    """Blog statistics response model."""

    total_posts: int
    published_posts: int
    total_categories: int
    total_tags: int
    total_comments: int
    total_views: int


router = APIRouter(prefix="/api/stats", tags=["Stats"])


@router.get("", response_model=BlogStatsResponse)
def get_blog_stats(db: Session = Depends(get_db)) -> BlogStatsResponse:
    """Get blog statistics."""
    # Total posts
    total_posts = db.query(func.count(models.Post.id)).scalar() or 0

    # Published posts
    published_posts = db.query(func.count(models.Post.id)).filter(models.Post.published).scalar() or 0

    # Total categories
    total_categories = db.query(func.count(models.Category.id)).scalar() or 0

    # Total tags
    total_tags = db.query(func.count(models.Tag.id)).scalar() or 0

    # Total comments
    total_comments = db.query(func.count(models.Comment.id)).scalar() or 0

    # Total views
    total_views = db.query(func.sum(models.Post.views)).scalar() or 0

    return BlogStatsResponse(
        total_posts=total_posts,
        published_posts=published_posts,
        total_categories=total_categories,
        total_tags=total_tags,
        total_comments=total_comments,
        total_views=total_views,
    )
