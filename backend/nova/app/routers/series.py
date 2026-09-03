from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.auth import User, get_current_admin
from app.cache import series_cache
from app.conditional import conditional_json
from app.database import get_db
from app.limiter import RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/series", tags=["series"])


@router.get("", response_model=list[schemas.SeriesPublic])
def list_series(request: Request, db: Session = Depends(get_db)):
    # One grouped count query for every series' visible-post count, not a
    # per-series count (RIL ISS-292). The list is small and computed per
    # request instead of cached — only the detail payload (which builds
    # reading_time per post) is cached (TASK-121).
    counts = crud.visible_series_post_counts(db)
    summaries = [
        schemas.SeriesPublic(
            id=s.id,
            title=s.title,
            slug=s.slug,
            description=s.description,
            post_count=counts.get(s.id, 0),
        )
        for s in crud.list_series(db)
    ]
    return conditional_json([s.model_dump(mode="json") for s in summaries], request)


@router.get("/{slug}", response_model=schemas.SeriesDetail)
def get_series(request: Request, slug: str, db: Session = Depends(get_db)):
    cached = series_cache.get(slug)
    if cached is not None:
        return conditional_json(cached, request)

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
    serialized = detail.model_dump(mode="json")
    series_cache[slug] = serialized
    return conditional_json(serialized, request)


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


class SeriesEpisodeItem(BaseModel):
    """One series post in admin episode order (DEC-146/TASK-185)."""

    id: int
    title: str
    slug: str
    series_order: int
    published: bool


class SeriesReorderBody(BaseModel):
    """Admin batch reorder payload: the series' post ids in desired order."""

    post_ids: list[int]


@router.get("/{series_id}/episodes", response_model=list[SeriesEpisodeItem])
def list_series_episodes(
    series_id: int,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Admin view of a series' episodes in order (any status incl. drafts)."""
    series = db.get(models.Series, series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    episodes = crud.list_series_episodes(db, series)
    return [
        SeriesEpisodeItem(
            id=p.id,
            title=p.title,
            slug=p.slug,
            series_order=p.series_order,
            published=bool(p.published),
        )
        for p in episodes
    ]


@router.put("/{series_id}/episodes/reorder", response_model=list[SeriesEpisodeItem])
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def reorder_series_episodes(
    request: Request,  # noqa: ARG001
    series_id: int,
    body: SeriesReorderBody,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Rewrite a series' episode order from an explicit post-id list (admin)."""
    series = db.get(models.Series, series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    try:
        episodes = crud.reorder_series_episodes(db, series, body.post_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    series_cache.pop(series.slug, None)
    return [
        SeriesEpisodeItem(
            id=p.id,
            title=p.title,
            slug=p.slug,
            series_order=p.series_order,
            published=bool(p.published),
        )
        for p in episodes
    ]
