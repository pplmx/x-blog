from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.auth import User, get_current_admin
from app.conditional import conditional_json
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[schemas.Tag])
def list_tags(request: Request, db: Session = Depends(get_db)):
    # crud.get_tags returns cached plain dicts (see cache.py).
    return conditional_json(crud.get_tags(db), request)


@router.get("/{tag_id}", response_model=schemas.Tag)
def get_tag(request: Request, tag_id: int, db: Session = Depends(get_db)):
    tag = crud.get_tag(db, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return conditional_json(schemas.Tag.model_validate(tag).model_dump(mode="json"), request)


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
    try:
        return crud.create_tag(db, tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{tag_id}", response_model=schemas.Tag)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def update_tag(
    request: Request,  # noqa: ARG001
    tag_id: int,
    tag: schemas.TagCreate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        db_tag = crud.update_tag(db, tag_id, tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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
    try:
        success = crud.delete_tag(db, tag_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Tag not found")
