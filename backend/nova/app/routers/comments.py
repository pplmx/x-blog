from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_COMMENT, client_rate_key, limiter

router = APIRouter(prefix="/api/comments", tags=["comments"])


class CommentListResponse(BaseModel):
    """Paginated comment list response (public — omits commenter PII)."""

    items: list[schemas.CommentPublic]
    total: int
    page: int
    limit: int
    total_pages: int


class CommentApproval(BaseModel):
    """Comment approval request."""

    approved: bool


@router.get("/post/{post_id}", response_model=CommentListResponse)
def list_comments(
    post_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get paginated approved comments for a post."""
    comments, total = crud.get_comments_paginated(db, post_id, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0

    return CommentListResponse(
        items=[schemas.Comment.model_validate(c) for c in comments],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.post("/post/{post_id}", response_model=schemas.Comment, status_code=201)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def create_comment(
    post_id: int,
    comment: schemas.CommentCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    # Drafts and not-yet-published scheduled posts are invisible to the public
    # (same rule as the read paths). Without this guard the endpoint became a
    # draft-existence oracle (201 here vs 400 "Post not found" for unknown ids)
    # and let visitors queue comments on drafts that surface once public.
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")

    # Use the same proxy-aware resolver as the rate limiter so the stored IP
    # matches the bucket key (X-Forwarded-For behind a trusted proxy), instead
    # of the immediate TCP peer which every client behind the proxy would share.
    ip_address = client_rate_key(request)
    try:
        return crud.create_comment(db, post_id, comment, ip_address)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{comment_id}/approve", response_model=schemas.Comment)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def approve_comment(
    request: Request,  # noqa: ARG001
    comment_id: int,
    approval: CommentApproval,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Approve or reject a comment. Admin only."""
    comment = crud.approve_comment(db, comment_id, approved=approval.approved)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    return comment


@router.delete("/{comment_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def delete_comment(
    request: Request,  # noqa: ARG001
    comment_id: int,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        success = crud.delete_comment(db, comment_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found")
