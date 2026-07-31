import csv
import io

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app import crud
from app.auth import User, get_current_admin
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


@router.get("/posts.csv")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def export_posts_csv(request: Request, db: Session = Depends(get_db), _current_user: User = Depends(get_current_admin)):  # noqa: ARG001
    """Export all published posts to CSV."""
    posts, _ = crud.get_posts(db, published=True, limit=10000)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Title", "Slug", "Excerpt", "Category", "Tags", "Views", "Likes", "Created At"])

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
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_admin),
):
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
                _csv_safe(comment.nickname),
                _csv_safe(comment.email or ""),
                _csv_safe(comment.content),
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
