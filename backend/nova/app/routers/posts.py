from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.auth import User, get_current_admin
from app.cache import posts_list_cache
from app.conditional import conditional_json
from app.database import get_db
from app.limiter import RATE_LIMIT_READ, RATE_LIMIT_WRITE, limiter

router = APIRouter(prefix="/api/posts", tags=["posts"])


class PostSubscriptionStatus(BaseModel):
    """Whether the signed-in reader follows a post's comment thread (DEC-078)."""

    post_id: int
    subscribed: bool


@router.get("/archive", response_model=list[schemas.ArchiveEntry])
def get_archive(request: Request, db: Session = Depends(get_db)):
    """Date-based archive index: (year, month, count) buckets newest-first."""
    rows = crud.get_archive(db)
    entries = [schemas.ArchiveEntry(year=y, month=m, count=c) for y, m, c in rows]
    return conditional_json([e.model_dump(mode="json") for e in entries], request)


@router.get("", response_model=schemas.PostListResponse)
def list_posts(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    category_id: int | None = None,
    tag_id: int | None = None,
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
):
    cache_key = (page, limit, category_id, tag_id, year, month)
    cached = posts_list_cache.get(cache_key)
    if cached is not None:
        return conditional_json(cached, request)

    skip = (page - 1) * limit
    posts, total = crud.get_posts(
        db,
        skip=skip,
        limit=limit,
        category_id=category_id,
        tag_id=tag_id,
        year=year,
        month=month,
    )

    total_pages = (total + limit - 1) // limit
    # model_validate (not __init__) applies from_attributes, converting the
    # ORM Post objects into PostList/PaginationMeta Pydantic models like
    # FastAPI does internally. We then dump to a plain dict for caching so
    # no live ORM objects survive across the per-request Session.
    response = schemas.PostListResponse.model_validate(
        {
            "items": posts,
            "pagination": {
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": total_pages,
            },
        }
    )
    serialized = response.model_dump(mode="json")
    posts_list_cache[cache_key] = serialized
    return conditional_json(serialized, request)


@router.get("/{post_id}", response_model=schemas.Post)
def get_post(post_id: str, db: Session = Depends(get_db)):
    # Post ids are SQLite/Postgres autoincrement integers, so a "numeric"
    # segment longer than 15 digits (64-bit int range) is never a real id —
    # only a slug or garbage. Cap the int() path: Python 3.14 raises
    # ValueError for >4300-digit int strings (unhandled 500 on a public
    # route) and Postgres would reject an out-of-range bind otherwise.
    # SLUG_PATTERN permits all-digit slugs (e.g. "123"), so a numeric segment
    # is tried as an id first and falls back to a slug lookup when no post
    # has that id (RIL TASK-093, ISS-074).
    is_numeric_id = len(post_id) <= 15 and post_id.isdigit() and post_id.isascii()
    post = crud.get_post(db, int(post_id)) if is_numeric_id else crud.get_post_by_slug(db, post_id)
    if is_numeric_id and post is None:
        post = crud.get_post_by_slug(db, post_id)
    # Drafts and not-yet-published scheduled posts are invisible to the public.
    if not post or not crud.is_publicly_visible(post):
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
    # Only count views for publicly visible posts (drafts are 404).
    existing = crud.get_post(db, post_id)
    if not existing or not crud.is_publicly_visible(existing):
        raise HTTPException(status_code=404, detail="Post not found")
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
    existing = crud.get_post(db, post_id)
    if not existing or not crud.is_publicly_visible(existing):
        raise HTTPException(status_code=404, detail="Post not found")
    post = crud.increment_likes(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@router.get("/popular/list", response_model=list[schemas.PostList])
def get_popular_posts(request: Request, limit: int = Query(5, ge=1, le=50), db: Session = Depends(get_db)):
    """Get the most popular posts by view count."""
    popular = [
        schemas.PostList.model_validate(p).model_dump(mode="json") for p in crud.get_popular_posts(db, limit=limit)
    ]
    return conditional_json(popular, request)


@router.get("/{post_id}/related", response_model=list[schemas.PostList])
def get_related_posts(
    request: Request,
    post_id: int,
    limit: int = Query(5, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Get related posts based on category and tags."""
    related = [
        schemas.PostList.model_validate(p).model_dump(mode="json")
        for p in crud.get_related_posts(db, post_id, limit=limit)
    ]
    return conditional_json(related, request)


@router.get("/{post_id}/adjacent", response_model=schemas.AdjacentPosts)
def get_adjacent_posts(request: Request, post_id: int, db: Session = Depends(get_db)):
    """Get the linear previous/next posts around a post, in public feed order.

    Returns ``{previous, next}`` (either may be null at the ends of the feed).
    A 404 is returned when the post does not exist or is not publicly visible.
    """
    if (existing := crud.get_post(db, post_id)) is None or not crud.is_publicly_visible(existing):
        raise HTTPException(status_code=404, detail="Post not found")
    previous, following = crud.get_adjacent_posts(db, post_id)
    return conditional_json(schemas.AdjacentPosts(previous=previous, next=following).model_dump(mode="json"), request)


# ---------------------------------------------------------------------------
# Comment-thread subscription (DEC-078/TASK-150): a signed-in reader follows a
# post's discussion and gets a best-effort Web Push when a new comment is
# approved. The response is reader-specific, so these endpoints deliberately
# return plain Pydantic models — NOT conditional_json: the shared ETag cache
# would echo one reader's state to every other visitor.
# ---------------------------------------------------------------------------


@router.get("/{post_id}/subscription", response_model=PostSubscriptionStatus)
def get_post_subscription_status(
    post_id: int,
    db: Session = Depends(get_db),
    reader: auth.ReaderAccount | None = Depends(auth.get_optional_reader),
):
    """Whether the signed-in reader follows this post's comment thread.

    Anonymous visitors get ``subscribed: false``. Unknown or not-yet-visible
    posts are uniformly 404 (no draft-existence oracle, same guard as the
    public comment-create/bookmark paths).
    """
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    subscribed = reader is not None and crud.get_comment_subscription(db, reader.id, post_id) is not None
    return PostSubscriptionStatus(post_id=post_id, subscribed=subscribed)


@router.put("/{post_id}/subscription", response_model=PostSubscriptionStatus, status_code=201)
def subscribe_to_post_thread(
    post_id: int,
    db: Session = Depends(get_db),
    reader: auth.ReaderAccount = Depends(auth.get_current_reader),
):
    """Follow a post's comment thread. Idempotent: re-subscribing returns the
    same 201 state (mirrors the bookmark PUT contract). Readers can only follow
    posts they can see — private/scheduled/unknown are uniformly 404."""
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    crud.add_comment_subscription(db, reader.id, post_id)
    return PostSubscriptionStatus(post_id=post_id, subscribed=True)


@router.delete("/{post_id}/subscription", status_code=204)
def unsubscribe_from_post_thread(
    post_id: int,
    db: Session = Depends(get_db),
    reader: auth.ReaderAccount = Depends(auth.get_current_reader),
):
    """Unfollow a post's comment thread. Idempotent: deleting a follow that is
    not present (or a post no longer public) is still a 204 no-op."""
    crud.remove_comment_subscription(db, reader.id, post_id)
    return None
