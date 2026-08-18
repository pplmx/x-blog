from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.auth import User, get_current_admin
from app.cache import series_cache
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/series", tags=["series"])


def _public_series_summary(db: Session, series: models.Series) -> schemas.SeriesPublic:
    """Live public summary with a visible-post count.

    The list is small and the count is one cheap grouped query per series, so
    it is computed per request instead of cached — only the detail payload
    (which builds reading_time per post) is cached (TASK-121).
    """
    return schemas.SeriesPublic(
        id=series.id,
        title=series.title,
        slug=series.slug,
        description=series.description,
        post_count=crud.count_visible_series_posts(db, series.id),
    )


@router.get("", response_model=list[schemas.SeriesPublic])
def list_series(db: Session = Depends(get_db)):
    return [_public_series_summary(db, s) for s in crud.list_series(db)]


@router.get("/{slug}", response_model=schemas.SeriesDetail)
def get_series(slug: str, db: Session = Depends(get_db)):
    cached = series_cache.get(slug)
    if cached is not None:
        return cached

    series = crud.get_series_by_slug(db, slug)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")

    posts = crud.get_series_visible_posts(db, series)
    # model_validate (not __init__) applies from_attributes, so the ORM Post
    # objects become PostList models; dump to a plain dict for the cache so no
    # live ORM objects survive across the per-request Session (post cache).
    detail = schemas.SeriesDetail.model_validate(
        {
            "id": series.id,
            "title": series.title,
            "slug": series.slug,
            "description": series.description,
            "post_count": len(posts),
            "posts": posts,
        }
    )
    serialized = detail.model_dump()
    series_cache[slug] = serialized
    return serialized


@router.post("", response_model=schemas.SeriesPublic, status_code=status.HTTP_201_CREATED)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def create_series(
    request: Request,  # noqa: ARG001
    series: schemas.SeriesCreate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    existing = crud.get_series_by_slug(db, series.slug)
    if existing:
        raise HTTPException(status_code=400, detail="Series already exists")
    try:
        return crud.create_series(db, series)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{series_id}", response_model=schemas.SeriesPublic)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def update_series(
    request: Request,  # noqa: ARG001
    series_id: int,
    series: schemas.SeriesUpdate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        db_series = crud.update_series(db, series_id, series)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not db_series:
        raise HTTPException(status_code=404, detail="Series not found")
    return db_series


@router.delete("/{series_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_series(
    request: Request,  # noqa: ARG001
    series_id: int,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        success = crud.delete_series(db, series_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Series not found")
