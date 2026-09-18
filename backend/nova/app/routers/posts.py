from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.auth import User, get_current_admin
from app.cache import posts_list_cache
from app.conditional import conditional_json
from app.database import get_db
from app.emailer import send_guest_thread_confirm_email
from app.limiter import RATE_LIMIT_NEWSLETTER, RATE_LIMIT_READ, RATE_LIMIT_WRITE, limiter
from app.middleware import get_logger
from app.schemas import EMAIL_PATTERN, IdInt, NonNulStr, PageInt

logger = get_logger(__name__)

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
    page: PageInt = 1,
    limit: int = Query(10, ge=1, le=100),
    category_id: IdInt | None = None,
    tag_id: IdInt | None = None,
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
):
    # Fire the scheduled-post publish-time fan-out (DEC-336/TASK-394) even on
    # a cache hit: the crossing has no write-time trigger, so the list read is
    # one of the first public surfaces to notice it. Cheap indexed no-op when
    # nothing crossed; exactly-once per post by the durable stamp.
    crud.maybe_notify_due_scheduled_posts(db)
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
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def get_post(
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    post_id: str,
    db: Session = Depends(get_db),
):
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
        # Slug-change redirect (round 350): when a post was re-slugged after
        # this slug lived publicly, surface the canonical target so the web
        # layer can emit a permanent 301 instead of a soft 404 — old links
        # keep working. The 404 contract is unchanged (detail untouched); the
        # redirect rides a response header the frontend reads.
        redirect_target = crud.resolve_slug_redirect(db, "post", post_id)
        if redirect_target:
            raise HTTPException(
                status_code=404,
                detail="Post not found",
                headers={"X-Redirect-To": f"/posts/{redirect_target}"},
            )
        raise HTTPException(status_code=404, detail="Post not found")
    # A scheduled post that crossed its publish_at since it was written needs
    # its first public read to fire the new-post fan-out (DEC-336/TASK-394 —
    # no background scheduler, DEC-076). Sweep the whole late set: cheap
    # indexed no-op when nothing crossed, exactly-once per post by stamp.
    crud.maybe_notify_due_scheduled_posts(db)
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
        # Author attribution (DEC-359/TASK-405): default to the writing admin,
        # the same semantics as the admin-posts route — never a post silently
        # without an author when the writer is known.
        return crud.create_post(db, post, author_id=post.author_id or _current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{post_id}", response_model=schemas.Post)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def update_post(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
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
    post_id: IdInt,
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
    post_id: IdInt,
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
    post_id: IdInt,
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


@router.get("/trending/list", response_model=list[schemas.TrendingPost])
def get_trending_posts(
    request: Request,
    days: int = Query(7, ge=1, le=30),
    limit: int = Query(5, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Public time-windowed top posts (round 387, DEC-438).

    Fresh-content discovery by in-window views from the ``post_views_daily``
    analytics table — /popular/list (all-time) cannot surface a new-but-already-
    read post. Each item carries ``views_window`` (the in-window sum). An empty
    window returns ``[]`` (fresh installs track forward only).
    """
    trending = [
        schemas.TrendingPost.model_validate(p).model_dump(mode="json")
        for p in crud.get_trending_posts(db, days=days, limit=limit)
    ]
    return conditional_json(trending, request)


@router.get("/{post_id}/related", response_model=list[schemas.PostList])
def get_related_posts(
    request: Request,
    post_id: IdInt,
    limit: int = Query(5, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Get related posts based on category and tags."""
    # Uniform non-public guard like every other public read path (get_adjacent_posts,
    # list_comments, bookmarks...): an unknown post id must 404, and a draft's id
    # must not act as an oracle for that draft's category. Previously this
    # returned 200 with generic/category-scoped posts for both, leaking draft
    # existence (backend deep-dive review).
    source = crud.get_post(db, post_id)
    if not source or not crud.is_publicly_visible(source):
        raise HTTPException(status_code=404, detail="Post not found")
    related = [
        schemas.PostList.model_validate(p).model_dump(mode="json")
        for p in crud.get_related_posts(db, post_id, limit=limit)
    ]
    return conditional_json(related, request)


@router.get("/{post_id}/adjacent", response_model=schemas.AdjacentPosts)
def get_adjacent_posts(request: Request, post_id: IdInt, db: Session = Depends(get_db)):
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
    post_id: IdInt,
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
    post_id: IdInt,
    response: Response,
    db: Session = Depends(get_db),
    reader: auth.ReaderAccount = Depends(auth.get_current_reader),
):
    """Follow a post's comment thread. Idempotent: first subscribe returns 201,
    a re-subscribe returns 200 (mirrors the bookmark PUT contract). Readers can
    only follow posts they can see — private/scheduled/unknown are uniformly
    404."""
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    _, created = crud.add_comment_subscription(db, reader.id, post_id)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return PostSubscriptionStatus(post_id=post_id, subscribed=True)


@router.delete("/{post_id}/subscription", status_code=204)
def unsubscribe_from_post_thread(
    post_id: IdInt,
    db: Session = Depends(get_db),
    reader: auth.ReaderAccount = Depends(auth.get_current_reader),
):
    """Unfollow a post's comment thread. Idempotent: deleting a follow that is
    not present (or a post no longer public) is still a 204 no-op."""
    crud.remove_comment_subscription(db, reader.id, post_id)
    return None


class GuestThreadSubscribeBody(BaseModel):
    email: Annotated[NonNulStr, Field(min_length=3, max_length=254, pattern=EMAIL_PATTERN)]
    # Round 381 (DEC-429): the follower's cadence choice made at subscribe time
    # — True = one weekly summary instead of a mail per approved comment.
    digest_weekly: bool = False

    @field_validator("email", mode="before")
    @classmethod
    def strip_email(cls, value: object) -> object:
        # Whitespace-only / padded input is normalized before pattern+length
        # validation (mirrors the shared email writers / newsletter body).
        return schemas._strip_blank(value) if isinstance(value, str) else value


class GuestThreadTokenBody(BaseModel):
    token: Annotated[NonNulStr, Field(max_length=64)]


class GuestThreadDigestBody(BaseModel):
    token: Annotated[NonNulStr, Field(max_length=64)]
    digest_weekly: bool


@router.post("/{post_id}/comment-subscription/guest", status_code=202)
@limiter.limit(f"{RATE_LIMIT_NEWSLETTER}/minute")
def guest_subscribe_to_post_thread(
    request: Request,  # noqa: ARG001 — slowapi injects for the rate-limit key
    post_id: IdInt,
    body: GuestThreadSubscribeBody,
    db: Session = Depends(get_db),
):
    """Guest thread-follow (DEC-427, TASK-438): an anonymous visitor subscribes
    to a post's discussion by email, no account needed.

    Records the (email, post) row and emails a double opt-in confirmation link
    — the address receives no thread mail until the token link is clicked.
    One generic message regardless of outcome (no existence oracle). Unknown /
    not-publicly-visible posts are uniformly 404 (mirrors the public
    comment/bookmark guard).

    Anti-abuse (mirrors the newsletter): the confirmation email fires ONLY when
    a NEW row is created, so a single attacker cannot turn each of N subscribe
    calls into N outbound mails to a victim address; the unauthenticated entry
    is on the dedicated tight per-IP bucket (``RATE_LIMIT_NEWSLETTER``).
    """
    email = body.email.strip().lower()
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    row, created = crud.add_guest_comment_subscription(db, email, post_id, digest_weekly=body.digest_weekly)
    if created:
        # Our insert won the race — this is the ONE confirmation email. A
        # resubscribed address (pending or confirmed) is never re-emailed.
        # Best-effort: a failure is swallowed; SMTP unconfigured -> pending.
        try:
            send_guest_thread_confirm_email(email, row.token, post.title or "")
        except Exception:  # noqa: BLE001
            logger.exception("guest thread confirm email failed for %s", email)
    return {"subscribed": True, "message": "If this email is new, a confirmation link is on its way"}


# Confirm / unsubscribe are TOKEN-only routes (mirroring the newsletter's
# /api/newsletter/confirm + /unsubscribe): the emailed links carry just the
# per-subscription token, and the token itself is the capability. They sit at
# static three-segment paths under /api/posts, so the dynamic /{post_id} routes
# never shadow them (FastAPI matches static paths first).


@router.post("/comment-subscription/guest/confirm", status_code=200)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def guest_confirm_post_thread(
    request: Request,  # noqa: ARG001
    body: GuestThreadTokenBody,
    db: Session = Depends(get_db),
):
    """Activate a guest thread-follow after its confirmation link is clicked
    (idempotent; an unknown token is 404 — no enumeration oracle). The stored
    cadence choice rides back so the confirm page can seed its weekly-summary
    toggle (DEC-429, mirroring the newsletter confirm response)."""
    if not crud.confirm_guest_comment_subscription(db, body.token):
        raise HTTPException(status_code=404, detail="Invalid token")
    row = crud.get_guest_comment_subscription_by_token(db, body.token)
    return {"confirmed": True, "digest_weekly": row.digest_weekly if row else False}


@router.post("/comment-subscription/guest/digest", status_code=200)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def guest_set_post_thread_digest(
    request: Request,  # noqa: ARG001
    body: GuestThreadDigestBody,
    db: Session = Depends(get_db),
):
    """Flip a guest thread-follow's cadence via its emailed token (round 381,
    DEC-429): weekly summary vs a mail per approved comment. Idempotent; an
    unknown token is 404 — the token is the capability, no credentials."""
    if not crud.set_guest_thread_digest(db, body.token, body.digest_weekly):
        raise HTTPException(status_code=404, detail="Invalid token")
    return {"digest_weekly": body.digest_weekly, "updated": True}


@router.post("/comment-subscription/guest/unsubscribe", status_code=200)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def guest_unsubscribe_post_thread(
    request: Request,  # noqa: ARG001
    body: GuestThreadTokenBody,
    db: Session = Depends(get_db),
):
    """Flip a guest thread-follow's consent off via its emailed token
    (idempotent; an unknown token is 404). Row + token stay, so a stale link
    keeps working and the address is not re-emailed."""
    if not crud.unsubscribe_guest_comment_subscription(db, body.token):
        raise HTTPException(status_code=404, detail="Invalid token")
    return {"unsubscribed": True}
