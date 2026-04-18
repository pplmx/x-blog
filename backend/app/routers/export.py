import csv
import io

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import crud
from app.database import get_db
from app.limiter import RATE_LIMIT_EXPORT, limiter

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/posts.csv")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def export_posts_csv(request: Request, db: Session = Depends(get_db)):  # noqa: ARG001
    """Export all published posts to CSV."""
    posts, _ = crud.get_posts(db, published=True, limit=10000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Title", "Slug", "Excerpt", "Category", "Tags", "Views", "Likes", "Created At"])

    for post in posts:
        writer.writerow(
            [
                post.id,
                post.title,
                post.slug,
                post.excerpt or "",
                post.category.name if post.category else "",
                ",".join(t.name for t in post.tags),
                post.views or 0,
                post.likes or 0,
                post.created_at.isoformat() if post.created_at else "",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=posts.csv"},
    )


@router.get("/comments.csv")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def export_comments_csv(request: Request, db: Session = Depends(get_db)):  # noqa: ARG001
    """Export all comments to CSV."""
    comments = db.query(crud.models.Comment).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Post ID", "Nickname", "Email", "Content", "Created At"])

    for comment in comments:
        writer.writerow(
            [
                comment.id,
                comment.post_id,
                comment.nickname,
                comment.email or "",
                comment.content,
                comment.created_at.isoformat() if comment.created_at else "",
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=comments.csv"},
    )
