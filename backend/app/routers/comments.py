from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import crud, schemas
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_COMMENT, limiter

router = APIRouter(prefix="/api/comments", tags=["comments"])


class CommentListResponse(BaseModel):
    """Paginated comment list response."""

    items: list[schemas.Comment]
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
    page: int = 1,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """Get paginated approved comments for a post."""
    comments, total = crud.get_comments_paginated(db, post_id, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0

    return CommentListResponse(
        items=comments,
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
    ip_address = request.client.host if request.client else "unknown"
    return crud.create_comment(db, post_id, comment, ip_address)


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
def delete_comment(request: Request, comment_id: int, db: Session = Depends(get_db)):  # noqa: ARG001
    success = crud.delete_comment(db, comment_id)
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found")
