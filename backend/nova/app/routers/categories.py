from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import schemas
from app.auth import User, get_current_admin
from app.conditional import conditional_json
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter
from app.schemas import IdInt
from app.services import categories as categories_service

router = APIRouter(prefix="/api/categories", tags=["categories"])


@router.get("", response_model=list[schemas.Category])
async def list_categories(request: Request, db: AsyncSession = Depends(get_db)):
    # categories_service.get_categories returns cached plain dicts (see cache.py).
    return conditional_json(await categories_service.get_categories(db), request)


@router.get("/{category_id}", response_model=schemas.Category)
async def get_category(request: Request, category_id: IdInt, db: AsyncSession = Depends(get_db)):
    category = await categories_service.get_category(db, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    # post_count is derived (not a column); the list endpoint computes it in a
    # grouped query, and validating the bare ORM object here would leave the
    # schema default 0 even for categories with many publicly visible posts
    # (ISS-363).
    data = schemas.Category.model_validate(category).model_dump(mode="json")
    data["post_count"] = await categories_service.category_visible_post_count(db, category_id)
    return conditional_json(data, request)


@router.post("", response_model=schemas.Category, status_code=status.HTTP_201_CREATED)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def create_category(
    request: Request,  # noqa: ARG001
    category: schemas.CategoryCreate,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    existing = await categories_service.get_category_by_name(db, category.name)
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")
    try:
        return await categories_service.create_category(db, category)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{category_id}", response_model=schemas.Category)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def update_category(
    request: Request,  # noqa: ARG001
    category_id: IdInt,
    category: schemas.CategoryCreate,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        db_category = await categories_service.update_category(db, category_id, category)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not db_category:
        raise HTTPException(status_code=404, detail="Category not found")
    return db_category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def delete_category(
    request: Request,  # noqa: ARG001
    category_id: IdInt,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        success = await categories_service.delete_category(db, category_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Category not found")
