from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app import auth, crud, models
from app.auth import ROLE_EDITOR, get_current_admin, get_current_superuser
from app.cache import (
    clear_categories_cache,
    clear_posts_list_cache,
    clear_tags_cache,
)
from app.crud import utc_now_naive
from app.database import get_db
from app.limiter import RATE_LIMIT_AUTH, RATE_LIMIT_WRITE, limiter
from app.schemas import PostCreate, PostUpdate

router = APIRouter(prefix="/api/admin", tags=["admin"])


class LoginResponse(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    # max_length 50 matches the User.username VARCHAR(50) column (issue #20).
    username: str = Field(
        min_length=3,
        max_length=50,
        pattern=r"^[a-zA-Z0-9_.-]+$",
        description="3-50 chars: letters, digits, underscore, dot, hyphen",
    )
    password: str = Field(min_length=8, description="Password must be at least 8 characters")


class NameRequest(BaseModel):
    """JSON body for category/tag create and rename (the admin UI sends a body)."""

    # max_length 50 matches Category/Tag.name VARCHAR(50).
    name: str = Field(max_length=50)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    is_superuser: bool


@router.post("/login", response_model=LoginResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def login(
    request: Request,  # noqa: ARG001
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(auth.User).filter(auth.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(data={"sub": user.id}, token_version=user.token_version or 0)
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
def get_current_user_profile(
    _current_user: auth.User = Depends(get_current_admin),
):
    """Return the current admin's profile (id, username, role).

    Lets the frontend adapt the admin UI: editors (non-superuser role) must not
    see superuser-only sections (users/export). (DEC-054, TASK-116)
    """
    return _current_user


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/users", response_model=UserResponse)
def create_user(
    request: Request,  # noqa: ARG001
    user_data: UserCreate,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    existing = db.query(auth.User).filter(auth.User.username == user_data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    hashed_password = auth.get_password_hash(user_data.password)
    # Created accounts are always editors (non-superuser), never admins — a
    # provisioned editor can moderate content but cannot manage users/export.
    # This is the safe-contract fix for ISS-087 (DEC-053/DEC-054).
    user = auth.User(
        username=user_data.username,
        password=hashed_password,
        role=ROLE_EDITOR,
        is_superuser=False,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Username already exists")
    db.refresh(user)
    return user


@router.get("/users", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    users = db.query(auth.User).all()
    return users


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/users/{user_id}")
def delete_user(
    request: Request,  # noqa: ARG001
    user_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    if user_id == _current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = db.query(auth.User).filter(auth.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


@router.get("/posts")
def admin_list_posts(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, description="Search by title"),
    status: str | None = Query(None, description="published | draft | scheduled"),
):
    query = db.query(models.Post)

    if q:
        query = query.filter(models.Post.title.ilike(f"%{crud.escape_like_pattern(q)}%", escape="\\"))

    if status == "published":
        now = utc_now_naive()
        query = query.filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    elif status == "draft":
        query = query.filter(models.Post.published == False)  # noqa: E712
    elif status == "scheduled":
        # A "scheduled" post is one that is published=True but not yet live
        # (its publish_at is in the future) — matching the stats endpoint. A
        # draft with a future publish_at is still a draft, not scheduled.
        now = utc_now_naive()
        query = query.filter(
            models.Post.published.is_(True),
            models.Post.publish_at > now,
        )

    total = query.count()

    posts = (
        query.options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .order_by(models.Post.pinned.desc(), models.Post.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    # Approved comment_count per post for this page (single grouped query, no
    # N+1) — mirrors crud.get_posts so the admin dashboard can render counts
    # for all statuses, not just the public published list.
    comment_counts: dict[int, int] = {}
    if posts:
        post_ids = [p.id for p in posts]
        rows = (
            db.query(models.Comment.post_id, func.count(models.Comment.id))
            .filter(
                models.Comment.post_id.in_(post_ids),
                models.Comment.is_approved.is_(True),
            )
            .group_by(models.Comment.post_id)
            .all()
        )
        comment_counts = {post_id: int(count) for post_id, count in rows}
    return {
        "items": [
            {
                "id": p.id,
                "title": p.title,
                "slug": p.slug,
                "published": p.published,
                "pinned": p.pinned,
                "publish_at": p.publish_at.isoformat() if p.publish_at else None,
                "views": p.views,
                "cover_image": p.cover_image,
                "category": p.category.name if p.category else None,
                "category_id": p.category_id,
                "comment_count": comment_counts.get(p.id, 0),
                "tags": [t.name for t in p.tags],
                "created_at": p.created_at.isoformat() if p.created_at else None,
                "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            }
            for p in posts
        ],
        "pagination": {
            "total": total,
            "skip": skip,
            "limit": limit,
        },
    }


@router.get("/posts/{post_id}", response_model=dict)
def admin_get_post(
    post_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = (
        db.query(models.Post)
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .filter(models.Post.id == post_id)
        .first()
    )
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return {
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "content": post.content,
        "excerpt": post.excerpt,
        "published": post.published,
        "pinned": post.pinned,
        "publish_at": post.publish_at.isoformat() if post.publish_at else None,
        "cover_image": post.cover_image,
        "category_id": post.category_id,
        "tag_ids": [t.id for t in post.tags],
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
    }


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/posts", response_model=dict)
def admin_create_post(
    request: Request,  # noqa: ARG001
    post_data: PostCreate,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    try:
        post = crud.create_post(db, post_data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": post.id}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.put("/posts/{post_id}", response_model=dict)
def admin_update_post(
    request: Request,  # noqa: ARG001
    post_id: int,
    post_data: PostUpdate,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if post_data.title is not None:
        post.title = post_data.title
    if post_data.slug is not None:
        post.slug = post_data.slug
    if post_data.content is not None:
        post.content = post_data.content
    if post_data.excerpt is not None:
        post.excerpt = post_data.excerpt
    if post_data.published is not None:
        post.published = post_data.published
    if post_data.pinned is not None:
        post.pinned = post_data.pinned

    # Fields that support explicit clearing (null) are handled via
    # model_dump(exclude_unset=True), which distinguishes "omitted" from
    # "explicitly null".
    update_fields = post_data.model_dump(exclude_unset=True)
    if "cover_image" in update_fields:
        # Explicit null clears the cover image (same semantics as category_id).
        post.cover_image = post_data.cover_image

    if "category_id" in update_fields:
        if post_data.category_id is not None:
            category = db.query(models.Category).filter(models.Category.id == post_data.category_id).first()
            if not category:
                raise HTTPException(status_code=400, detail=f"Category with id {post_data.category_id} not found")
            post.category_id = post_data.category_id
        else:
            post.category_id = None

    if post_data.tag_ids is not None:
        tags = db.query(models.Tag).filter(models.Tag.id.in_(post_data.tag_ids)).all()
        post.tags = tags

    if "publish_at" in update_fields:
        post.publish_at = post_data.publish_at

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Slug already exists")
    db.refresh(post)
    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()
    return {"id": post.id}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/posts/{post_id}")
def admin_delete_post(
    request: Request,  # noqa: ARG001
    post_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    db.delete(post)
    db.commit()
    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()
    return {"message": "Post deleted"}


@router.get("/categories", response_model=list[dict])
def admin_list_categories(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    categories = db.query(models.Category).all()
    # Post count per category in a single grouped query (no N+1).
    rows = (
        db.query(models.Post.category_id, func.count(models.Post.id))
        .filter(models.Post.category_id.isnot(None))
        .group_by(models.Post.category_id)
        .all()
    )
    counts = {cat_id: int(count) for cat_id, count in rows}
    return [{"id": c.id, "name": c.name, "post_count": counts.get(c.id, 0)} for c in categories]


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/categories", response_model=dict)
def admin_create_category(
    request: Request,  # noqa: ARG001
    body: NameRequest,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    name = body.name
    existing = db.query(models.Category).filter(models.Category.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")

    category = models.Category(name=name)
    db.add(category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Category already exists")
    db.refresh(category)
    clear_categories_cache()
    return {"id": category.id, "name": category.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.put("/categories/{category_id}", response_model=dict)
def admin_update_category(
    request: Request,  # noqa: ARG001
    category_id: int,
    body: NameRequest,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    category.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Category already exists")
    clear_categories_cache()
    # Renamed name is embedded in cached public post lists and feeds (ISS-057).
    clear_posts_list_cache()
    return {"id": category.id, "name": category.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/categories/{category_id}")
def admin_delete_category(
    request: Request,  # noqa: ARG001
    category_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Check for posts referencing this category
    post_count = db.query(models.Post).filter(models.Post.category_id == category_id).count()
    if post_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete category: {post_count} post(s) reference it",
        )

    db.delete(category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete category: it is referenced by posts",
        )
    clear_categories_cache()
    return {"message": "Category deleted"}


@router.get("/tags", response_model=list[dict])
def admin_list_tags(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tags = db.query(models.Tag).all()
    # Post count per tag through the many-to-many join table, one grouped query.
    rows = (
        db.query(models.post_tags.c.tag_id, func.count(models.post_tags.c.post_id))
        .group_by(models.post_tags.c.tag_id)
        .all()
    )
    counts = {tag_id: int(count) for tag_id, count in rows}
    return [{"id": t.id, "name": t.name, "post_count": counts.get(t.id, 0)} for t in tags]


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/tags", response_model=dict)
def admin_create_tag(
    request: Request,  # noqa: ARG001
    body: NameRequest,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    name = body.name
    existing = db.query(models.Tag).filter(models.Tag.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")

    tag = models.Tag(name=name)
    db.add(tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Tag already exists")
    db.refresh(tag)
    clear_tags_cache()
    return {"id": tag.id, "name": tag.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.put("/tags/{tag_id}", response_model=dict)
def admin_update_tag(
    request: Request,  # noqa: ARG001
    tag_id: int,
    body: NameRequest,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Tag already exists")
    clear_tags_cache()
    # Renamed name is embedded in cached public post lists and feeds (ISS-057).
    clear_posts_list_cache()
    return {"id": tag.id, "name": tag.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/tags/{tag_id}")
def admin_delete_tag(
    request: Request,  # noqa: ARG001
    tag_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    # Check for posts referencing this tag
    post_count = db.query(models.Post).filter(models.Post.tags.any(id=tag_id)).count()
    if post_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete tag: {post_count} post(s) reference it",
        )

    db.delete(tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete tag: it is referenced by posts",
        )
    clear_tags_cache()
    return {"message": "Tag deleted"}


# Comments management
@router.get("/comments")
def admin_list_comments(
    post_id: int | None = None,
    is_approved: bool | None = Query(None, description="Filter by moderation status"),
    q: str | None = Query(None, description="Search nickname/email/content"),
    date_from: datetime | None = Query(None, description="ISO date filter: created >= date_from"),
    date_to: datetime | None = Query(None, description="ISO date filter: created <= date_to"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """List comments with pagination + filters (bounded response, issue #20)."""
    query = db.query(models.Comment, models.Post.title).join(models.Post, models.Post.id == models.Comment.post_id)
    if post_id:
        query = query.filter(models.Comment.post_id == post_id)
    if is_approved is not None:
        query = query.filter(models.Comment.is_approved.is_(is_approved))
    if q:
        like = f"%{crud.escape_like_pattern(q)}%"
        query = query.filter(
            or_(
                models.Comment.nickname.ilike(like, escape="\\"),
                models.Comment.email.ilike(like, escape="\\"),
                models.Comment.content.ilike(like, escape="\\"),
            )
        )
    if date_from:
        start = date_from
        if start.tzinfo is not None:
            start = start.astimezone(UTC).replace(tzinfo=None)
        query = query.filter(models.Comment.created_at >= start)
    if date_to:
        end = date_to
        if end.tzinfo is not None:
            end = end.astimezone(UTC).replace(tzinfo=None)
        query = query.filter(models.Comment.created_at <= end)
    total = query.count()

    comment_rows = query.order_by(models.Comment.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    result = []
    for c, post_title in comment_rows:
        result.append(
            {
                "id": c.id,
                "post_id": c.post_id,
                "post_title": post_title,
                "nickname": c.nickname,
                "email": c.email,
                "content": c.content,
                "ip_address": c.ip_address,
                "is_approved": c.is_approved,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
        )
    return {
        "items": result,
        "pagination": {
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


class BatchApproveRequest(BaseModel):
    # Cap the batch so one request cannot touch an unbounded number of rows.
    ids: list[int] = Field(max_length=100)
    approved: bool = True


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/comments/batch-approve")
def admin_batch_approve_comments(
    request: Request,  # noqa: ARG001
    body: BatchApproveRequest,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    comments = db.query(models.Comment).filter(models.Comment.id.in_(body.ids)).all()
    for c in comments:
        c.is_approved = body.approved
    db.commit()
    # Approving/rejecting changes the approved comment_count embedded in the
    # cached public post list, so invalidate it (ISS-056).
    clear_posts_list_cache()
    return {"message": f"{len(comments)} comments updated"}


# Password management
class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, description="New password must be at least 8 characters")


@router.post("/password")
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def change_password(
    request: Request,  # noqa: ARG001
    body: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: auth.User = Depends(get_current_admin),
):
    if not auth.verify_password(body.current_password, current_user.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.password = auth.get_password_hash(body.new_password)
    # Invalidate every previously-issued JWT for this admin: bump the token
    # version checked in get_current_user. (RIL round 16 security audit)
    current_user.token_version = (current_user.token_version or 0) + 1
    db.commit()
    return {"message": "Password updated"}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/comments/{comment_id}")
def admin_delete_comment(
    request: Request,  # noqa: ARG001
    comment_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    db.delete(comment)
    try:
        db.commit()
    except IntegrityError:
        # Parent comment with replies: FK violation on Postgres, orphaned
        # replies on SQLite (FKs off). Reject with a clear 400 like the
        # public delete path instead of a 500.
        db.rollback()
        raise HTTPException(status_code=400, detail="Cannot delete comment: it has dependent records")
    # Deleting an approved comment changes the approved comment_count surfaced
    # on the cached public posts list; invalidate like the other comment
    # mutations do (RIL TASK-092, ISS-072).
    clear_posts_list_cache()
    return {"message": "Comment deleted"}
