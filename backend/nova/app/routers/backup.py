"""Full-blog backup & restore (DEC-082, TASK-153).

The admin CSV export is reporting-oriented (one filtered table per request).
This module exposes the whole blog as ONE portable JSON snapshot — categories,
tags, series, posts (with links + counts) and comment threads — and restores a
snapshot into a fresh or existing instance via natural-key upserts.

Both endpoints are superuser-only (restore is a bulk write and export carries
commenter PII), rate-limited like the CSV export, and deliberately never touch
auth data: reader accounts / admin users / password hashes / browser push
subscriptions do not round-trip (DEC-082).
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import crud
from app.auth import User, get_current_superuser
from app.database import get_db
from app.limiter import RATE_LIMIT_EXPORT, limiter

router = APIRouter(prefix="/api/admin/backup", tags=["export"])

# A generous-but-bounded acceptance guard so an absurd body can't be buffered
# into an unbounded restore: 20k posts is far beyond a real blog (the CSV
# export cap is 100k rows), and each post may carry comments.
MAX_RESTORE_POSTS = 20_000


class BackupRestoreRequest(BaseModel):
    """The ``x-blog-backup`` v1 snapshot (extra keys tolerated)."""

    format: str
    version: int
    exported_at: str | None = None
    categories: list[dict] = Field(default_factory=list)
    tags: list[dict] = Field(default_factory=list)
    series: list[dict] = Field(default_factory=list)
    posts: list[dict] = Field(default_factory=list)


@router.get("")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def get_backup(
    request: Request,  # noqa: ARG001
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    """The whole blog as a portable ``x-blog-backup`` v1 JSON snapshot."""
    return crud.build_backup_snapshot(db)


@router.post("/restore")
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def restore_backup(
    request: Request,  # noqa: ARG001
    data: BackupRestoreRequest,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_superuser),
):
    """Import an ``x-blog-backup`` snapshot (natural-key upserts, idempotent).

    Categories/tags by name, series by slug, posts by slug, comments by
    (post, import_key). Returns per-entity created/updated/skipped counts.
    """
    if len(data.posts) > MAX_RESTORE_POSTS:
        raise HTTPException(status_code=422, detail=f"Too many posts (max {MAX_RESTORE_POSTS})")
    try:
        return crud.restore_backup(db, data.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
