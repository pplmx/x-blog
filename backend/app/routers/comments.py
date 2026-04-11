from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from typing import List
from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/api/comments", tags=["comments"])


@router.get("/post/{post_id}", response_model=List[schemas.Comment])
def list_comments(post_id: int, db: Session = Depends(get_db)):
    return crud.get_comments(db, post_id)


@router.post("/post/{post_id}", response_model=schemas.Comment, status_code=201)
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
