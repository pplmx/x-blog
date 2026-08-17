import csv
import io
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import crud, models
from app.auth import User, get_current_superuser
from app.database import get_db
from app.limiter import RATE_LIMIT_EXPORT, limiter

router = APIRouter(prefix="/api/export", tags=["export"])

# Characters that make a cell a formula in spreadsheet applications
_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_safe(value: object) -> object:
    """Neutralize spreadsheet formula injection in user-controlled CSV fields.

    Cells beginning with =, +, -, @, tab or CR are treated as formulas by
    Excel/LibreOffice. Prefixing with a single quote renders them as text.
    """
    if isinstance(value, str) and value.startswith(_CSV_FORMULA_PREFIXES):
        return f"'{value}"
    return value


def _normalize_naive(value: datetime) -> datetime:
    """Coerce an (optionally tz-aware) filter datetime to naive-UTC for the column."""
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


@router.get("/posts.csv")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def export_posts_csv(
    request: Request,  # noqa: ARG001
    status: str | None = Query(None, description="published | draft | scheduled | all"),
    date_from: datetime | None = Query(None, description="ISO date: created >= date_from"),
    date_to: datetime | None = Query(None, description="ISO date: created <= date_to"),
    limit: int = Query(10000, ge=1, le=100000),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    """Export posts to CSV, filterable by status and created-date range.

    Previously only published posts were exported (hard-capped at 10000 with
    no status/date control) — drafts and scheduled posts were silently omitted.
    Now status defaults to "all"; add the status/date columns so an admin can
    see each row's moderation state (RIL TASK-079, ISS-048).
    """
    query = db.query(models.Post)
    if status == "published":
        query = query.filter(models.Post.published.is_(True))
    elif status == "draft":
        query = query.filter(models.Post.published == False)  # noqa: E712
    elif status == "scheduled":
        now = crud.utc_now_naive()
        query = query.filter(models.Post.publish_at > now)
    # status None/"all" → every post regardless of state.
    if date_from:
        query = query.filter(models.Post.created_at >= _normalize_naive(date_from))
    if date_to:
        query = query.filter(models.Post.created_at <= _normalize_naive(date_to))

    posts = query.limit(limit).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "ID",
            "Title",
            "Slug",
            "Excerpt",
            "Category",
            "Tags",
            "Views",
            "Likes",
            "Status",
            "Pinned",
            "Publish At",
            "Created At",
        ]
    )

    for post in posts:
        writer.writerow(
            [
                post.id,
                _csv_safe(post.title),
                _csv_safe(post.slug),
                _csv_safe(post.excerpt or ""),
                _csv_safe(post.category.name if post.category else ""),
                _csv_safe(",".join(t.name for t in post.tags)),
                post.views or 0,
                post.likes or 0,
                "published" if post.published else "draft",
                "yes" if post.pinned else "no",
                post.publish_at.isoformat() if post.publish_at else "",
                post.created_at.isoformat() if post.created_at else "",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=posts.csv",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/comments.csv")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def export_comments_csv(
    request: Request,  # noqa: ARG001
    is_approved: bool | None = Query(None, description="Filter by moderation status"),
    date_from: datetime | None = Query(None, description="ISO date: created >= date_from"),
    date_to: datetime | None = Query(None, description="ISO date: created <= date_to"),
    limit: int = Query(10000, ge=1, le=100000),
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    """Export comments to CSV, filterable by moderation status and date range.

    Previously every comment (including unapproved) was dumped with no filter.
    Now supports is_approved + date filters and surfaces the moderation state
    in a dedicated column (RIL TASK-079, ISS-048).
    """
    query = db.query(models.Comment)
    if is_approved is not None:
        query = query.filter(models.Comment.is_approved.is_(is_approved))
    if date_from:
        query = query.filter(models.Comment.created_at >= _normalize_naive(date_from))
    if date_to:
        query = query.filter(models.Comment.created_at <= _normalize_naive(date_to))

    comments = query.order_by(models.Comment.created_at.desc()).limit(limit).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Post ID", "Nickname", "Email", "Content", "Status", "Created At"])

    for comment in comments:
        writer.writerow(
            [
                comment.id,
                comment.post_id,
                _csv_safe(comment.nickname),
                _csv_safe(comment.email or ""),
                _csv_safe(comment.content),
                "approved" if comment.is_approved else "pending",
                comment.created_at.isoformat() if comment.created_at else "",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=comments.csv",
            "X-Content-Type-Options": "nosniff",
        },
    )
