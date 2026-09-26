import csv
import io
from collections.abc import Iterator
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from app import crud, models
from app.auth import User, get_current_superuser
from app.database import get_db
from app.dates import inclusive_end_of_day, parse_bound
from app.limiter import RATE_LIMIT_EXPORT, limiter

router = APIRouter(prefix="/api/export", tags=["export"])

# Both CSV exports used to materialize EVERY ORM row (`.all()`) and the whole
# CSV in one StringIO before streaming a single chunk — O(n) memory on an
# admin-only endpoint (a 100k-post export ≈ tens of MB of models + a buffer)
# and no bytes until every row is serialized. Now the row sources page the
# query and yield chunk-by-chunk (ISS-637). Chunks are byte-identical to one
# csv.writer pass: concatenating them reproduces the old single CSV exactly.
# The response generators run while FastAPI's get_db teardown is deferred
# (dependency cleanup happens after a StreamingResponse finishes), so
# re-querying per page keeps a live session.
EXPORT_PAGE_SIZE = 500


def _csv_chunks(headers: list[str], row_iter: Iterator[list[str]]) -> Iterator[str]:
    """Yield the CSV header line, then one chunk per data row.

    Each chunk is a complete csv.writer row (``\r\n``-terminated), so a stream
    consumer that concatenates the chunks gets the exact single-pass CSV — and
    a consumer that stops early saves all the serialization of the tail.
    """

    def _row(row: list[str]) -> str:
        buf = io.StringIO()
        csv.writer(buf).writerow(row)
        return buf.getvalue()

    yield _row(headers)
    for row in row_iter:
        yield _row(row)


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


def _csv_status(post: models.Post, now: datetime) -> str:
    """CSV Status cell, aligned with the read-path semantics: a published post
    whose ``publish_at`` is still in the future reads "scheduled" — it is not
    live yet — not "published" (RIL ISS-290)."""
    if not post.published:
        return "draft"
    return "scheduled" if post.publish_at and post.publish_at > now else "published"


@router.get("/posts.csv")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def export_posts_csv(
    request: Request,  # noqa: ARG001
    status: str | None = Query(None, description="published | draft | scheduled | all"),
    date_from: str | None = Query(None, max_length=40, description="ISO date: created >= date_from"),
    date_to: str | None = Query(
        None, max_length=40, description="ISO date: created <= date_to (a bare date includes the whole day)"
    ),
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
        # "Scheduled" means actually going live: published AND not yet its
        # publish time. A future-publish_at DRAFT never goes live, so it does
        # not belong under this filter (RIL ISS-290).
        query = query.filter(models.Post.published.is_(True), models.Post.publish_at > crud.utc_now_naive())
    # status None/"all" → every post regardless of state. A bare-date date_to
    # is widened to end-of-day so the picked day is included in the export.
    start = parse_bound(date_from)
    end = parse_bound(inclusive_end_of_day(date_to)) if date_to else None
    if start is not None:
        query = query.filter(models.Post.created_at >= start)
    if end is not None:
        query = query.filter(models.Post.created_at <= end)

    # category/tags are read per row below; eager-load so a page of posts stays
    # a handful of queries instead of ~2 lazy loads per row (RIL ISS-289).
    # Deterministic order: without an ORDER BY, the LIMIT-selected subset above
    # the cap is chosen by the query plan — unreproducible, and the remainder is
    # unreachable. Post.id desc is cheap (PK index) and matches the DEC-239
    # tiebreak idiom (the sibling comments export already orders by created_at).
    def _post_rows() -> Iterator[list[str]]:
        # Keyset page by id because the tags eager-load is a joined collection,
        # which Query.yield_per refuses; id-desc keyset keeps the same
        # deterministic order and one bounded query per page (ISS-637).
        now = crud.utc_now_naive()
        remaining = limit
        last_id: int | None = None
        while remaining > 0:
            page_query = query if last_id is None else query.filter(models.Post.id < last_id)
            want = min(EXPORT_PAGE_SIZE, remaining)
            page = (
                page_query.options(joinedload(models.Post.category), joinedload(models.Post.tags))
                .order_by(models.Post.id.desc())
                .limit(want)
                .all()
            )
            if not page:
                return
            for post in page:
                last_id = post.id
                yield [
                    post.id,
                    _csv_safe(post.title),
                    _csv_safe(post.slug),
                    _csv_safe(post.excerpt or ""),
                    _csv_safe(post.category.name if post.category else ""),
                    _csv_safe(",".join(t.name for t in post.tags)),
                    post.views or 0,
                    post.likes or 0,
                    _csv_status(post, now),
                    "yes" if post.pinned else "no",
                    post.publish_at.isoformat() if post.publish_at else "",
                    post.created_at.isoformat() if post.created_at else "",
                ]
            remaining -= len(page)
            if len(page) < want:
                return

    return StreamingResponse(
        _csv_chunks(
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
            ],
            _post_rows(),
        ),
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
    date_from: str | None = Query(None, max_length=40, description="ISO date: created >= date_from"),
    date_to: str | None = Query(
        None, max_length=40, description="ISO date: created <= date_to (a bare date includes the whole day)"
    ),
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
    start = parse_bound(date_from)
    end = parse_bound(inclusive_end_of_day(date_to)) if date_to else None
    if start is not None:
        query = query.filter(models.Comment.created_at >= start)
    if end is not None:
        query = query.filter(models.Comment.created_at <= end)

    # Scalar-only query (no joined collections), so Query.yield_per batches the
    # rows instead of materializing the whole result set for the CSV pass (the
    # posts export keysets by id because its tags eager-load is a collection,
    # which yield_per refuses). Same created_at-desc order as before.
    comments = query.order_by(models.Comment.created_at.desc()).limit(limit).yield_per(EXPORT_PAGE_SIZE)

    def _comment_rows() -> Iterator[list[str]]:
        for comment in comments:
            yield [
                comment.id,
                comment.post_id,
                _csv_safe(comment.nickname),
                _csv_safe(comment.email or ""),
                _csv_safe(comment.content),
                "approved" if comment.is_approved else "pending",
                comment.created_at.isoformat() if comment.created_at else "",
            ]

    return StreamingResponse(
        _csv_chunks(["ID", "Post ID", "Nickname", "Email", "Content", "Status", "Created At"], _comment_rows()),
        media_type="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=comments.csv",
            "X-Content-Type-Options": "nosniff",
        },
    )
