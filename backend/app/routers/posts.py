from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_READ, RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/posts", tags=["posts"])


@router.get("", response_model=schemas.PostListResponse)
def list_posts(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    category_id: int | None = None,
    tag_id: int | None = None,
    db: Session = Depends(get_db),
):
    skip = (page - 1) * limit
    posts, total = crud.get_posts(
        db,
        skip=skip,
        limit=limit,
        category_id=category_id,
        tag_id=tag_id,
    )

    total_pages = (total + limit - 1) // limit
    return {
        "items": posts,
        "pagination": {
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        },
    }


@router.get("/{post_id}", response_model=schemas.Post)
def get_post(post_id: str, db: Session = Depends(get_db)):
    post = (
        crud.get_post(db, int(post_id))
        if post_id.isdigit() and post_id.isascii()
        else crud.get_post_by_slug(db, post_id)
    )
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@router.post("", response_model=schemas.Post, status_code=status.HTTP_201_CREATED)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def create_post(
    request: Request,  # noqa: ARG001
    post: schemas.PostCreate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    existing = crud.get_post_by_slug(db, post.slug)
    if existing:
        raise HTTPException(status_code=400, detail="Slug already exists")
    try:
        return crud.create_post(db, post)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{post_id}", response_model=schemas.Post)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def update_post(
    request: Request,  # noqa: ARG001
    post_id: int,
    post: schemas.PostUpdate,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        db_post = crud.update_post(db, post_id, post)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    return db_post


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_post(
    request: Request,  # noqa: ARG001
    post_id: int,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        success = crud.delete_post(db, post_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Post not found")


@router.post("/{post_id}/view", response_model=schemas.Post)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def increment_views(
    request: Request,  # noqa: ARG001
    post_id: int,
    db: Session = Depends(get_db),
):
    """Increment the view count for a post."""
    post = crud.increment_views(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@router.post("/{post_id}/like", response_model=schemas.Post)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def increment_likes(
    request: Request,  # noqa: ARG001
    post_id: int,
    db: Session = Depends(get_db),
):
    """Increment the like count for a post."""
    post = crud.increment_likes(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@router.get("/popular/list", response_model=list[schemas.PostList])
def get_popular_posts(limit: int = Query(5, ge=1, le=50), db: Session = Depends(get_db)):
    """Get the most popular posts by view count."""
    return crud.get_popular_posts(db, limit=limit)


@router.get("/{post_id}/related", response_model=list[schemas.PostList])
def get_related_posts(post_id: int, limit: int = Query(5, ge=1, le=50), db: Session = Depends(get_db)):
    """Get related posts based on category and tags."""
    return crud.get_related_posts(db, post_id, limit=limit)
