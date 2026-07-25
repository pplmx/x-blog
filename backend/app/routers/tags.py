from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[schemas.Tag])
def list_tags(db: Session = Depends(get_db)):
    return crud.get_tags(db)


@router.get("/{tag_id}", response_model=schemas.Tag)
def get_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = crud.get_tag(db, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.post("", response_model=schemas.Tag, status_code=status.HTTP_201_CREATED)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def create_tag(
    request: Request,  # noqa: ARG001
    tag: schemas.TagCreate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    existing = crud.get_tag_by_name(db, tag.name)
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")
    return crud.create_tag(db, tag)


@router.put("/{tag_id}", response_model=schemas.Tag)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def update_tag(
    request: Request,  # noqa: ARG001
    tag_id: int,
    tag: schemas.TagCreate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    db_tag = crud.update_tag(db, tag_id, tag)
    if not db_tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return db_tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_tag(
    request: Request,  # noqa: ARG001
    tag_id: int,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    success = crud.delete_tag(db, tag_id)
    if not success:
        raise HTTPException(status_code=404, detail="Tag not found")
