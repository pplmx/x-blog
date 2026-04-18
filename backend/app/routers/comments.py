from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import crud, schemas
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


@router.get("/post/{post_id}", response_model=CommentListResponse)
def list_comments(
    post_id: int,
    page: int = 1,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    """Get paginated comments for a post."""
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


@router.delete("/{comment_id}", status_code=204)
def delete_comment(comment_id: int, db: Session = Depends(get_db)):
    crud.delete_comment(db, comment_id)
