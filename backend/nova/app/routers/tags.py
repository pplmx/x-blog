from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.auth import User, get_current_admin
from app.conditional import conditional_json
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter
from app.schemas import IdInt
from app.services import tags as tags_service

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[schemas.Tag])
async def list_tags(request: Request, db: AsyncSession = Depends(get_db)):
    # tags_service.get_tags returns cached plain dicts (see cache.py).
    return conditional_json(await tags_service.get_tags(db), request)


@router.get("/{tag_id}", response_model=schemas.Tag)
async def get_tag(request: Request, tag_id: IdInt, db: AsyncSession = Depends(get_db)):
    tag = await tags_service.get_tag(db, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    # post_count is derived (not a column); validating the bare ORM object
    # would leave the schema default 0 even for tags with many posts (ISS-363).
    data = schemas.Tag.model_validate(tag).model_dump(mode="json")
    data["post_count"] = await tags_service.tag_visible_post_count(db, tag_id)
    return conditional_json(data, request)


@router.post("", response_model=schemas.Tag, status_code=status.HTTP_201_CREATED)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def create_tag(
    request: Request,  # noqa: ARG001
    tag: schemas.TagCreate,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await tags_service.get_tag_by_name(db, tag.name)
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")
    try:
        return await tags_service.create_tag(db, tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{tag_id}", response_model=schemas.Tag)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def update_tag(
    request: Request,  # noqa: ARG001
    tag_id: IdInt,
    tag: schemas.TagCreate,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        db_tag = await tags_service.update_tag(db, tag_id, tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not db_tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return db_tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def delete_tag(
    request: Request,  # noqa: ARG001
    tag_id: IdInt,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        success = await tags_service.delete_tag(db, tag_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Tag not found")
