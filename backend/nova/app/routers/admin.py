from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.security import OAuth2PasswordRequestForm
from PIL import UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import auth, models
from app.auth import ROLE_EDITOR, get_current_admin, get_current_superuser
from app.cache import (
    clear_categories_cache,
    clear_posts_list_cache,
    clear_tags_cache,
)
from app.database import get_db
from app.exceptions import AppException
from app.image_validation import (
    ALLOWED_TYPES,
    ALLOWED_TYPES_MAP,
    MAX_SIZE,
    has_matching_magic_bytes,
    optimize_image,
    verify_image_decodes,
)
from app.limiter import RATE_LIMIT_AUTH, RATE_LIMIT_WRITE, client_rate_key, limiter
from app.routers.comments import AUTO_APPROVE_READER_COMMENTS
from app.schemas import (
    AuthorBrief,
    Comment,
    IdInt,
    NonNulStr,
    PageInt,
    Post,
    PostCreate,
    PostRevisionDetail,
    PostRevisionSummary,
    PostUpdate,
)
from app.services import admin as admin_service
from app.services.admin import utc_now_naive

logger = logging.getLogger(__name__)

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
    # Public pen name (DEC-359/TASK-405): the byline shown on published posts.
    # NULL means no public identity — the username stays private (admin login
    # is no-oracle) but the author gets no byline/archive until one is chosen.
    display_name: Annotated[NonNulStr | None, Field(default=None, min_length=1, max_length=50)] = None
    # Public "about this writer" (round 357): short plain-text bio rendered on
    # the writer's /authors/{id} archive header. Same 500-char cap as the
    # reader bio (round 352) so one request cannot bloat the row unbounded.
    bio: Annotated[NonNulStr | None, Field(default=None, max_length=500)] = None

    @field_validator("display_name", mode="before")
    @classmethod
    def strip_display_name(cls, value: object) -> object:
        # Whitespace-only display_name passes min_length=1 (Pydantic counts raw
        # chars) and would become a blank public byline — strip before length
        # validation so "   " becomes None (no public identity), the same
        # boundary discipline as the reader profile name fields (ISS-456).
        return (value.strip() or None) if isinstance(value, str) else value

    @field_validator("bio", mode="before")
    @classmethod
    def strip_bio(cls, value: object) -> object:
        # A whitespace-only bio is an empty bio: fold it to None (which under
        # exclude_unset still counts as an explicit clear on save) — same
        # boundary discipline as the reader bio validator.
        stripped = (value.strip() or None) if isinstance(value, str) else value
        return stripped or None


class NameRequest(BaseModel):
    """JSON body for category/tag create and rename (the admin UI sends a body)."""

    # max_length 50 matches Category/Tag.name VARCHAR(50).
    name: Annotated[NonNulStr, Field(max_length=50)]


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    is_superuser: bool
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None


# A valid bcrypt hash of a random throwaway password, at the same cost as a
# real user hash. When the username is unknown we still run bcrypt against this
# so the login endpoint's response *timing* does not reveal whether an admin
# username exists (unknown username must not short-circuit faster than a wrong
# password — same pattern as reader login in reader.py; security review).
_FAKE_ADMIN_BCRYPT_HASH = "$2b$12$K7LqkVaQ1OiOsahF1P17/uM5UQi7QkS5d8ZqS3mDzW0yPj2k9VxG"


@router.post("/login", response_model=LoginResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
async def login(
    request: Request,  # noqa: ARG001
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    # Reject NUL before it reaches the SQL bind: psycopg cannot bind a string
    # containing \x00 and raises (uncaught) -> 500 on a public login endpoint
    # (ISS-454). The JSON bodies get this via NonNulStr; OAuth2PasswordRequestForm
    # is not a Pydantic model, so guard the form fields by hand. Rejecting the
    # *pair* keeps the "unknown vs wrong password" timing equalized once we're
    # past this cheap shape check (a NUL username can never be a real user).
    if "\x00" in form_data.username or "\x00" in form_data.password:
        raise HTTPException(status_code=422, detail="Invalid login")
    user = (await db.execute(select(auth.User).where(auth.User.username == form_data.username))).scalar_one_or_none()
    if not user:
        # Time the miss like a real verification so a known username is not
        # distinguishable from an unknown one by response latency.
        auth.verify_password(form_data.password, _FAKE_ADMIN_BCRYPT_HASH)
        user = None
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
async def create_user(
    request: Request,  # noqa: ARG001
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    existing = (
        await db.execute(select(auth.User).where(auth.User.username == user_data.username))
    ).scalar_one_or_none()
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
        display_name=user_data.display_name,
        bio=user_data.bio,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Username already exists")
    await db.refresh(user)
    return user


class UserUpdate(BaseModel):
    """Editable admin-user fields (DEC-359, TASK-405; bio round 357).

    Currently the public pen name plus the public "about this writer" bio; the
    login username, role and password all have their own gates. ``display_name``
    and ``bio`` distinguish "omitted" (don't change) from an explicit null
    (clear the byline/bio / return to no public identity).
    """

    display_name: Annotated[NonNulStr, Field(min_length=1, max_length=50)] | None = Field(default=None)
    bio: Annotated[NonNulStr | None, Field(default=None, max_length=500)] = None

    @field_validator("display_name", mode="before")
    @classmethod
    def strip_display_name(cls, value: object) -> object:
        return (value.strip() or None) if isinstance(value, str) else value

    @field_validator("bio", mode="before")
    @classmethod
    def strip_bio(cls, value: object) -> object:
        # A whitespace-only bio is an empty bio: fold to None (explicit clear).
        stripped = (value.strip() or None) if isinstance(value, str) else value
        return stripped or None


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.patch("/users/{user_id}", response_model=UserResponse)
async def update_user(
    request: Request,  # noqa: ARG001
    user_id: IdInt,
    user_data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    """Edit an admin user's public pen name and "about this writer" bio (superuser).

    Without this the byline/bio feature would only work for users created after
    the fact — the seeded admin (or any pre-existing editor) could never gain
    a public identity. An explicit ``display_name: null`` clears the byline,
    an explicit ``bio: null`` clears the bio.
    """
    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    updates = user_data.model_dump(exclude_unset=True)
    if "display_name" in updates:
        user.display_name = updates["display_name"]
    if "bio" in updates:
        user.bio = updates["bio"]
    await db.commit()
    await db.refresh(user)
    # The pen name/bio render on post bylines, series details and the RSS/Atom
    # posts feed (AuthorBrief from cached objects) — a rename must not linger
    # as the old name in lists/feeds for the cache TTL (ISS-607/TASK-529).
    clear_posts_list_cache()
    return user


# Author avatar storage lives in a dedicated static/avatars/ namespace (same
# choice as the reader avatar, DEC-299): the admin media listing walks
# static/uploads/ only, so a writer's profile picture must not appear in or
# collide with the author's uploaded post images.
AUTHOR_AVATAR_DIR = Path(__file__).parent.parent.parent / "static" / "avatars"
# Avatars are stored as `{uuid4}.{ext}` (same shape as media uploads); the
# remove route whitelists the exact shape so a DB value can never become a
# filesystem path outside the avatar dir (mirrors upload.py's _FILENAME_RE
# and reader.py's reader-avatar guard).
_AUTHOR_AVATAR_FILENAME_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$"
)


def _delete_author_avatar_file(avatar_url: str | None) -> None:
    """Best-effort delete of a stored author-avatar file, given its /static URL.

    Only ever removes a file whose name matches the exact avatar shape (so a
    corrupted/foreign avatar_url value can't be turned into a filesystem path —
    path-traversal guard, same discipline as reader.py). A missing file is
    fine — the URL is the source of truth and a stale row shouldn't fail the
    write that cleans it up.
    """
    if not avatar_url:
        return
    name = avatar_url.rsplit("/", 1)[-1]
    if not _AUTHOR_AVATAR_FILENAME_RE.match(name):
        return
    path = AUTHOR_AVATAR_DIR / name
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("could not remove stale author-avatar file %s", path)


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/users/{user_id}/avatar", response_model=UserResponse)
async def upload_user_avatar(
    request: Request,  # noqa: ARG001
    user_id: IdInt,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    """Set an admin user's public profile picture (superuser, round 358).

    The face half of the writer identity surface (pen name + bio + avatar):
    whoever sets the pen name and bio (superuser-only PATCH /users/{id}) also
    sets the face. Same defense-in-depth validation as the reader avatar
    (content-type whitelist, size cap, magic bytes, full Pillow decode,
    never-larger re-encode that strips EXIF) via the shared
    app.image_validation. The new avatar is written to static/avatars first,
    then the DB row is updated and any previous avatar file removed, so a
    failed write never leaves a dangling URL. The login username is never
    exposed by any of this — avatar_url is a public /static URL only.
    """
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, detail="Unsupported file type")
    # Cap memory: read at most MAX_SIZE+1 bytes and reject before an oversized
    # body balloons RAM (reading the whole stream first would buffer it all).
    contents = await file.read(MAX_SIZE + 1)
    if len(contents) > MAX_SIZE:
        raise HTTPException(400, detail="File too large (max 5MB)")
    if not has_matching_magic_bytes(contents, file.content_type):
        raise HTTPException(400, detail="File content does not match the declared image type")
    try:
        verify_image_decodes(contents)
    except UnidentifiedImageError, OSError, ValueError:
        raise HTTPException(400, detail="File is not a valid image")

    contents = optimize_image(contents, file.content_type)

    # Resolve the target user BEFORE writing anything to disk so an unknown id
    # 404s without orphaning a file in static/avatars.
    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ext = ALLOWED_TYPES_MAP.get(file.content_type, "jpg")
    filename = f"{uuid4()}.{ext}"
    AUTHOR_AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    filepath = AUTHOR_AVATAR_DIR / filename
    filepath.write_bytes(contents)

    previous = user.avatar_url
    user.avatar_url = f"/static/avatars/{filename}"
    await db.commit()
    await db.refresh(user)
    _delete_author_avatar_file(previous)
    # Avatar swaps are visible on cached post bylines / series details / feeds
    # (AuthorBrief.avatar_url) — clear so the new face appears immediately
    # (same cache contract as the other author-identity writes, ISS-607).
    clear_posts_list_cache()
    return user


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/users/{user_id}/avatar", response_model=UserResponse)
async def remove_user_avatar(
    request: Request,  # noqa: ARG001
    user_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    """Remove an admin user's public profile picture (stored file + DB row)."""
    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    previous = user.avatar_url
    if previous:
        user.avatar_url = None
        await db.commit()
        await db.refresh(user)
        _delete_author_avatar_file(previous)
        # Removing the face changes every byline that showed it; clear so the
        # cached post lists / series / feeds drop the deleted avatar (ISS-607).
        clear_posts_list_cache()
    return user


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    users = (await db.execute(select(auth.User))).scalars().all()
    return users


@router.get("/authors", response_model=list[AuthorBrief])
async def list_pennamed_authors(
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """The post editor's author picker (DEC-359, TASK-406).

    Every admin with a public pen name, so any editor can attribute a post
    they wrote to another public writer — deliberately NOT superuser-only like
    /users: an editor must be able to assign authors, and exposing pen names
    leaks nothing (they already appear on every byline). Admins without a pen
    name are excluded — they have no public identity to attribute to — and the
    login username never appears (admin login is no-oracle; /users stays
    superuser-only for the credential-adjacent surface).
    """
    users = (
        (await db.execute(select(auth.User).where(auth.User.display_name.isnot(None)).order_by(auth.User.display_name)))
        .scalars()
        .all()
    )
    return users


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    request: Request,  # noqa: ARG001
    user_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_superuser),
):
    if user_id == _current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # AuthorFollow is an additive DEC-009 table with no ORM cascade from User:
    # purge the writer-follow rows too, or a deleted author leaves stale
    # follows that, on SQLite autoincrement id reuse, re-point at an unrelated
    # later user (same orphan class as category/tag/series follows — deep-dive
    # finding).
    await db.execute(delete(models.AuthorFollow).where(models.AuthorFollow.author_id == user_id))
    await db.delete(user)
    await db.commit()


@router.get("/posts")
async def admin_list_posts(
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    q: Annotated[NonNulStr | None, Query(description="Search by title")] = None,
    status: Annotated[
        Literal["published", "draft", "scheduled"] | None,
        Query(description="published | draft | scheduled"),
    ] = None,
):
    stmt = select(models.Post)

    if q:
        stmt = stmt.where(models.Post.title.ilike(f"%{admin_service.escape_like_pattern(q)}%", escape="\\"))

    if status == "published":
        now = utc_now_naive()
        stmt = stmt.where(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    elif status == "draft":
        stmt = stmt.where(models.Post.published == False)  # noqa: E712
    elif status == "scheduled":
        # A "scheduled" post is one that is published=True but not yet live
        # (its publish_at is in the future) — matching the stats endpoint. A
        # draft with a future publish_at is still a draft, not scheduled.
        now = utc_now_naive()
        stmt = stmt.where(
            models.Post.published.is_(True),
            models.Post.publish_at > now,
        )

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0

    posts = (
        (
            await db.execute(
                stmt.options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
                # id tiebreak: imported/bulk-restored rows share created_at; without a
                # unique final sort key, offset pages can skip/duplicate across page
                # boundaries on ties (same fix the moderation queue got — get_comments_paginated).
                # COALESCE pinned like admin_service.get_posts (TASK-535 parity): a raw-import
                # NULL-pinned row must sort with the unpinned group, not first.
                .order_by(
                    func.coalesce(models.Post.pinned, False).desc(),
                    models.Post.created_at.desc(),
                    models.Post.id.desc(),
                )
                .offset(skip)
                .limit(limit)
            )
        )
        .unique()
        .scalars()
        .all()
    )
    # Approved comment_count per post for this page (single grouped query, no
    # N+1) — mirrors admin_service.get_posts so the admin dashboard can render counts
    # for all statuses, not just the public published list.
    comment_counts: dict[int, int] = {}
    if posts:
        post_ids = [p.id for p in posts]
        rows = (
            await db.execute(
                select(models.Comment.post_id, func.count(models.Comment.id))
                .where(
                    models.Comment.post_id.in_(post_ids),
                    models.Comment.is_approved.is_(True),
                )
                .group_by(models.Comment.post_id)
            )
        ).all()
        comment_counts = {post_id: int(count) for post_id, count in rows}
    return {
        "items": [
            {
                "id": p.id,
                "title": p.title,
                "slug": p.slug,
                "published": p.published,
                # Coalesce raw-import NULLs (TASK-535/ISS-627 parity): the
                # public API reads these as false/0, so the admin list must not
                # show null for the same rows.
                "pinned": bool(p.pinned or False),
                "publish_at": p.publish_at.isoformat() if p.publish_at else None,
                "views": p.views or 0,
                "cover_image": p.cover_image,
                "category": p.category.name if p.category else None,
                "category_id": p.category_id,
                "comment_count": comment_counts.get(p.id, 0),
                "tags": [t.name for t in p.tags],
                "series_id": p.series_id,
                "series_order": p.series_order,
                "series_title": p.series.title if p.series else None,
                "series_slug": p.series.slug if p.series else None,
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


@router.get("/calendar", response_model=dict)
async def admin_calendar(
    month: str = Query(..., pattern=r"^\d{4}-\d{2}$", description="Month to view, YYYY-MM"),
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Month-bucketed posts for the editorial calendar (DEC-162, TASK-194).

    Each post carries a ``type`` the calendar colors (published / scheduled /
    draft) and a ``date`` the grid places it on:
      - scheduled: published=True with publish_at in the future -> publish_at
      - published: published=True, already live -> publish_at or created_at
      - draft: not published -> its intended publish_at, if any
    Undated drafts are returned separately under ``unscheduled`` — a plan view
    shouldn't hide them, but they have no grid day. The query is bounded to
    posts whose publish_at / created_at fall in or near the month (a post from
    long ago has no day in this grid); the classification matches the posts
    list status semantics. Dates are naive UTC (utc_now_naive contract, same
    as schedule comparisons); the frontend renders them in the operator's
    local tz by appending 'Z'.
    """
    try:
        month_start = datetime.strptime(f"{month}-01", "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid month; use YYYY-MM")
    # Naive UTC window: the next month's first day is the grid upper bound, and
    # a small lead-in tolerance keeps tz-heavy publish_at values from dropping
    # off the edge of the grid they visually belong to.
    month_end = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    window_start = month_start - timedelta(days=3)

    def classify(p: models.Post) -> tuple[str, datetime | None]:
        if p.published and p.publish_at is not None and p.publish_at > utc_now_naive():
            return "scheduled", p.publish_at
        if p.published:
            return "published", p.publish_at or p.created_at
        return "draft", p.publish_at

    posts = (
        (
            await db.execute(
                select(models.Post)
                .options(joinedload(models.Post.category))
                .where(
                    or_(
                        and_(
                            models.Post.publish_at.isnot(None),
                            models.Post.publish_at >= window_start,
                        ),
                        and_(
                            models.Post.created_at.isnot(None),
                            models.Post.created_at >= window_start,
                        ),
                    )
                )
            )
        )
        .scalars()
        .all()
    )

    grid: list[dict] = []
    unscheduled: list[dict] = []
    for p in posts:
        ptype, when = classify(p)
        entry = {
            "id": p.id,
            "title": p.title,
            "slug": p.slug,
            "type": ptype,
            "date": when.isoformat() if when else None,
            "published": p.published,
            "publish_at": p.publish_at.isoformat() if p.publish_at else None,
            "category": p.category.name if p.category else None,
        }
        if when is None:
            # Draft with no intended date yet — keep it visible but off-grid.
            if ptype == "draft":
                unscheduled.append(entry)
            continue
        if month_start <= when < month_end:
            grid.append(entry)
        elif ptype == "draft":
            # A draft planned for outside the viewed month (the primary editorial
            # use case: "I'm writing this for next month") has a non-None
            # publish_at that fails the grid range — it would land on neither the
            # grid nor `unscheduled`, exactly the plan item `unscheduled` exists
            # to surface. A draft is a plan, not a fact: keep it off-grid but
            # visible in the unscheduled (plan) list (round-292 deep-dive).
            unscheduled.append(entry)

    grid.sort(key=lambda e: (e["date"] or "", e["id"]))
    unscheduled.sort(key=lambda e: e["id"])
    return {"month": month, "items": grid, "unscheduled": unscheduled}


@router.get("/posts/{post_id}", response_model=dict)
async def admin_get_post(
    post_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = (
        (
            await db.execute(
                select(models.Post)
                .options(
                    joinedload(models.Post.category),
                    joinedload(models.Post.tags),
                    joinedload(models.Post.series),
                )
                .where(models.Post.id == post_id)
            )
        )
        .unique()
        .scalar_one_or_none()
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
        # Coalesce raw-import NULLs (TASK-535/ISS-627 parity): a pinned/views
        # NULL row is a real edge on import; the editor must see false/0 like
        # the public page, not null.
        "pinned": bool(post.pinned or False),
        "comments_enabled": post.comments_enabled,
        "publish_at": post.publish_at.isoformat() if post.publish_at else None,
        "cover_image": post.cover_image,
        "category_id": post.category_id,
        "series_id": post.series_id,
        "series_order": post.series_order,
        "series_title": post.series.title if post.series else None,
        "series_slug": post.series.slug if post.series else None,
        # Author attribution (DEC-359/TASK-406): the editor loads the current
        # author of a post from the admin detail so it can pre-select the
        # author picker (admin-only surface, so no no-oracle concern).
        "author_id": post.author_id,
        "tag_ids": [t.id for t in post.tags],
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
    }


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/posts", response_model=dict, status_code=status.HTTP_201_CREATED)
async def admin_create_post(
    request: Request,  # noqa: ARG001
    post_data: PostCreate,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    try:
        # Author attribution (DEC-359/TASK-405): default to the writing admin;
        # an editor may explicitly attribute the post to another admin.
        post = await admin_service.create_post(db, post_data, author_id=post_data.author_id or _current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": post.id}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/posts/{post_id}/clone", response_model=dict)
async def admin_clone_post(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    _current_user: auth.User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Duplicate a post into a fresh draft (round 349): same content +
    taxonomy + attribution, a new unique slug, and every publication-
    metadata field cleared (unpublished, unscheduled, unpinned, zeroed
    views/likes) — so an editor can seed a sibling post from a template
    without the copy-paste dance and without leaking a live post."""
    source = (await db.execute(select(models.Post).where(models.Post.id == post_id))).scalar_one_or_none()
    if not source:
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        post = await admin_service.clone_post(db, source)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": post.id}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.put("/posts/{post_id}", response_model=dict)
async def admin_update_post(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    post_data: PostUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    try:
        return await admin_service.update_post(db, post_id, post_data.model_dump(exclude_unset=True), logger)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_post(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    # admin_service.delete_post purges the DEC-009 child tables (bookmarks/history/
    # subscriptions/daily views) along with the post and its cascaded comments
    # and revisions — keep the admin route on the same code path (RIL ISS-296).
    try:
        success = await admin_service.delete_post(db, post_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Post not found")


@router.get("/posts/{post_id}/revisions", response_model=list[PostRevisionSummary])
async def admin_list_post_revisions(
    post_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = (await db.execute(select(models.Post).where(models.Post.id == post_id))).scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return await admin_service.get_post_revisions(db, post_id)


@router.get("/posts/{post_id}/revisions/{revision_id}", response_model=PostRevisionDetail)
async def admin_get_post_revision(
    post_id: IdInt,
    revision_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    revision = await admin_service.get_post_revision(db, post_id, revision_id)
    if not revision:
        raise HTTPException(status_code=404, detail="Revision not found")
    return revision


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/posts/{post_id}/revisions/{revision_id}/restore", response_model=Post)
async def admin_restore_post_revision(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    revision_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    try:
        return await admin_service.restore_post_revision(db, post_id, revision_id)
    except ValueError as e:
        msg = str(e)
        code = 404 if "not found" in msg else 400
        raise HTTPException(status_code=code, detail=msg)


@router.get("/categories", response_model=list[dict])
async def admin_list_categories(
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    categories = (await db.execute(select(models.Category))).scalars().all()
    # Post count per category in a single grouped query (no N+1).
    rows = (
        await db.execute(
            select(models.Post.category_id, func.count(models.Post.id))
            .where(models.Post.category_id.isnot(None))
            .group_by(models.Post.category_id)
        )
    ).all()
    counts = {cat_id: int(count) for cat_id, count in rows}
    return [{"id": c.id, "name": c.name, "post_count": counts.get(c.id, 0)} for c in categories]


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/categories", response_model=dict)
async def admin_create_category(
    request: Request,  # noqa: ARG001
    body: NameRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    name = body.name
    existing = (await db.execute(select(models.Category).where(models.Category.name == name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")

    category = models.Category(name=name)
    db.add(category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Category already exists")
    await db.refresh(category)
    clear_categories_cache()
    return {"id": category.id, "name": category.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.put("/categories/{category_id}", response_model=dict)
async def admin_update_category(
    request: Request,  # noqa: ARG001
    category_id: IdInt,
    body: NameRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    category = (await db.execute(select(models.Category).where(models.Category.id == category_id))).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    category.name = body.name
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Category already exists")
    clear_categories_cache()
    # Renamed name is embedded in cached public post lists and feeds (ISS-057).
    clear_posts_list_cache()
    return {"id": category.id, "name": category.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_category(
    request: Request,  # noqa: ARG001
    category_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    category = (await db.execute(select(models.Category).where(models.Category.id == category_id))).scalar_one_or_none()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    # Check for posts referencing this category
    post_count = (
        await db.execute(select(func.count()).select_from(models.Post).where(models.Post.category_id == category_id))
    ).scalar() or 0
    if post_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete category: {post_count} post(s) reference it",
        )

    await db.delete(category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete category: it is referenced by posts",
        )
    clear_categories_cache()


@router.get("/tags", response_model=list[dict])
async def admin_list_tags(
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tags = (await db.execute(select(models.Tag))).scalars().all()
    # Post count per tag through the many-to-many join table, one grouped query.
    rows = (
        await db.execute(
            select(models.post_tags.c.tag_id, func.count(models.post_tags.c.post_id)).group_by(
                models.post_tags.c.tag_id
            )
        )
    ).all()
    counts = {tag_id: int(count) for tag_id, count in rows}
    return [{"id": t.id, "name": t.name, "post_count": counts.get(t.id, 0)} for t in tags]


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/tags", response_model=dict)
async def admin_create_tag(
    request: Request,  # noqa: ARG001
    body: NameRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    name = body.name
    existing = (await db.execute(select(models.Tag).where(models.Tag.name == name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")

    tag = models.Tag(name=name)
    db.add(tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Tag already exists")
    await db.refresh(tag)
    clear_tags_cache()
    return {"id": tag.id, "name": tag.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.put("/tags/{tag_id}", response_model=dict)
async def admin_update_tag(
    request: Request,  # noqa: ARG001
    tag_id: IdInt,
    body: NameRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tag = (await db.execute(select(models.Tag).where(models.Tag.id == tag_id))).scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag.name = body.name
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Tag already exists")
    clear_tags_cache()
    # Renamed name is embedded in cached public post lists and feeds (ISS-057).
    clear_posts_list_cache()
    return {"id": tag.id, "name": tag.name}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_tag(
    request: Request,  # noqa: ARG001
    tag_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tag = (await db.execute(select(models.Tag).where(models.Tag.id == tag_id))).scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    # Check for posts referencing this tag
    post_count = (
        await db.execute(select(func.count()).select_from(models.Post).where(models.Post.tags.any(id=tag_id)))
    ).scalar() or 0
    if post_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete tag: {post_count} post(s) reference it",
        )

    await db.delete(tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete tag: it is referenced by posts",
        )
    clear_tags_cache()


# Comments management
@router.get("/comments")
async def admin_list_comments(
    post_id: IdInt | None = None,
    is_approved: bool | None = Query(None, description="Filter by moderation status"),
    q: Annotated[NonNulStr | None, Query(description="Search nickname/email/content")] = None,
    date_from: str | None = Query(None, max_length=40, description="ISO date filter: created >= date_from"),
    date_to: str | None = Query(
        None, max_length=40, description="ISO date filter: created <= date_to (a bare date includes the whole day)"
    ),
    flagged: bool | None = Query(None, description="Filter to comments that have reader flags"),
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """List comments with pagination + filters (bounded response, issue #20)."""
    return await admin_service.list_comments(db, post_id, is_approved, q, date_from, date_to, flagged, page, limit)


class BatchApproveRequest(BaseModel):
    # Cap the batch so one request cannot touch an unbounded number of rows.
    ids: list[int] = Field(max_length=100)
    approved: bool = True


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/comments/batch-approve")
async def admin_batch_approve_comments(
    request: Request,  # noqa: ARG001
    body: BatchApproveRequest,
    db: AsyncSession = Depends(get_db),
    # Superuser-only by design (test_role_tiers: "a non-superuser editor CANNOT
    # ... batch-approve"): bulk-approve touches many comments at once and is a
    # privileged bulk action, unlike the point moderation peers.
    _current_user: auth.User = Depends(get_current_superuser),
):
    return await admin_service.batch_approve_comments(db, body.ids, body.approved)


class BatchDeleteRequest(BaseModel):
    # Cap the batch so one request cannot touch an unbounded number of rows.
    ids: list[int] = Field(max_length=100)


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/comments/batch-delete")
async def admin_batch_delete_comments(
    request: Request,  # noqa: ARG001
    body: BatchDeleteRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Bulk-delete selected comments (own-user, spam cleanup). DEC-110.

    Surviving replies are reparented consistently (admin_service.bulk_delete_comments)
    so the thread is never orphaned. Returns the number deleted.
    """
    try:
        deleted = await admin_service.bulk_delete_comments(db, body.ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"deleted": deleted}


# Password management
class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, description="New password must be at least 8 characters")


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/comments/{comment_id}/flags")
async def dismiss_comment_flags(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Clear all reader flags on a comment (moderator dismissed the reports)."""
    try:
        return await admin_service.dismiss_comment_flags(db, comment_id)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/password")
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
async def change_password(
    request: Request,  # noqa: ARG001
    body: PasswordChangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: auth.User = Depends(get_current_admin),
):
    if not auth.verify_password(body.current_password, current_user.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    current_user.password = auth.get_password_hash(body.new_password)
    # Invalidate every previously-issued JWT for this admin: bump the token
    # version checked in get_current_user. (RIL round 16 security audit)
    current_user.token_version = (current_user.token_version or 0) + 1
    await db.commit()
    return {"message": "Password updated"}


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_comment(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    try:
        await admin_service.delete_comment(db, comment_id)
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Author-reply identity (DEC-192, TASK-212): the blog owner's replies to
# commenters carry this nickname — brand it per deployment via env, default to
# the site's product name. It is server-set, never client-supplied, so a
# commenter cannot spoof the author banner.
AUTHOR_REPLY_NICKNAME = os.getenv("AUTHOR_REPLY_NICKNAME", "X-Blog")


class AdminReplyRequest(BaseModel):
    """Body for POST /api/admin/comments/{id}/reply (DEC-192)."""

    content: str = Field(min_length=1, max_length=5000)


@router.post("/comments/{comment_id}/reply", response_model=Comment, status_code=status.HTTP_201_CREATED)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def admin_reply_comment(
    request: Request,
    comment_id: IdInt,
    body: AdminReplyRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Reply to a comment as the blog author (DEC-192, TASK-212).

    Lets the owner answer a commenter right from the moderation queue instead
    of publishing a whole post reply. The reply is an immediately-approved
    comment (the author needs no moderation) flagged ``is_author_reply`` so the
    public thread can render the "author" badge, and it fires the same
    notifications as an approved comment — the replied-to reader plus the
    thread's followers (``_notify_comment_approved``). Content width matches
    CommentBase; rendering sanitization stays where it is for every comment
    (render-time, DEC-088).
    """
    try:
        return await admin_service.reply_comment(
            db, comment_id, body.content, client_rate_key(request), AUTHOR_REPLY_NICKNAME
        )
    except AppException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Runtime site settings (DEC-100, TASK-162): operator-controlled key/values.
# A persisted value wins over the env fallback read by the comment-create path;
# GET returns the effective value for display. Keys are whitelisted so clients
# can't enumerate or write arbitrary rows (404 for unknown keys).
KNOWN_BOOLEAN_SETTINGS = {"auto_approve_reader_comments"}


class SettingRead(BaseModel):
    key: str
    value: str


class SettingUpdate(BaseModel):
    value: str


async def _effective_boolean_setting(db: AsyncSession, key: str, env_default: bool) -> bool:
    return await admin_service.boolean_setting(db, key, env_default)


@router.get("/settings/{key}", response_model=SettingRead)
async def get_site_setting_ep(
    key: str,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Read a runtime site setting (admin only). Unknown keys are 404."""
    if key not in KNOWN_BOOLEAN_SETTINGS:
        raise HTTPException(status_code=404, detail="Unknown setting")
    effective = await _effective_boolean_setting(db, key, AUTO_APPROVE_READER_COMMENTS)
    return SettingRead(key=key, value="true" if effective else "false")


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.put("/settings/{key}", response_model=SettingRead)
async def put_site_setting_ep(
    request: Request,  # noqa: ARG001
    key: str,
    body: SettingUpdate,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Persist a runtime site setting (admin only). Unknown keys / bad values 404/422."""
    if key not in KNOWN_BOOLEAN_SETTINGS:
        raise HTTPException(status_code=404, detail="Unknown setting")
    normalized = body.value.strip().lower()
    if normalized not in {"true", "false", "1", "0", "yes", "no", "on", "off"}:
        raise HTTPException(status_code=422, detail="value must be a boolean string")
    canonical = "true" if normalized in {"1", "true", "yes", "on"} else "false"
    await admin_service.upsert_site_setting(db, key, canonical)
    return SettingRead(key=key, value=canonical)


# ---------------------------------------------------------------------------
# Reader account moderation (DEC-194, TASK-214, ISS-116)
# ---------------------------------------------------------------------------


class AdminReaderSummary(BaseModel):
    """One operator-facing reader row incl. moderation-relevant aggregates."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str | None = None
    is_active: bool = True
    created_at: datetime | None = None
    last_login_at: datetime | None = None
    comment_count: int = 0
    bookmark_count: int = 0


class AdminReaderStatusResponse(BaseModel):
    """Row returned by deactivate/activate so the UI can patch its list in place."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    is_active: bool
    last_login_at: datetime | None = None


@router.get("/readers")
async def admin_list_readers(
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    q: Annotated[NonNulStr | None, Query(description="Search email / display name")] = None,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """List registered reader accounts with moderation aggregates (admin only).

    Any admin role (superuser or editor) may view readers — this is a
    moderation responsibility like the comment queue, not the superuser-only
    admin-users provisioning surface.
    """
    stmt = select(auth.ReaderAccount)
    if q:
        like = f"%{admin_service.escape_like_pattern(q)}%"
        stmt = stmt.where(
            or_(
                auth.ReaderAccount.email.ilike(like, escape="\\"),
                auth.ReaderAccount.display_name.ilike(like, escape="\\"),
            )
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    rows = (
        (
            await db.execute(
                stmt.order_by(auth.ReaderAccount.created_at.desc(), auth.ReaderAccount.id.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    # Aggregate counts for the page rows in two grouped queries (no N+1).
    reader_ids = [r.id for r in rows]
    comment_counts: dict[int, int] = {}
    bookmark_counts: dict[int, int] = {}
    if reader_ids:
        # Explicit typed comprehensions keep pyright happy (the plain
        # dict(row_list) idiom resolves rows to bytes, ISS-123). Comment
        # reader_id is nullable (anonymous comments) -> drop None keys.
        comment_rows = (
            await db.execute(
                select(models.Comment.reader_id, func.count(models.Comment.id))
                .where(models.Comment.reader_id.in_(reader_ids))
                .group_by(models.Comment.reader_id)
            )
        ).all()
        comment_counts = {rid: int(n) for rid, n in comment_rows if rid is not None}
        bookmark_rows = (
            await db.execute(
                select(models.ReaderBookmark.reader_id, func.count(models.ReaderBookmark.id))
                .where(models.ReaderBookmark.reader_id.in_(reader_ids))
                .group_by(models.ReaderBookmark.reader_id)
            )
        ).all()
        bookmark_counts = {rid: int(n) for rid, n in bookmark_rows}
    items = [
        AdminReaderSummary(
            id=r.id,
            email=r.email,
            display_name=r.display_name,
            is_active=bool(r.is_active),
            created_at=r.created_at,
            last_login_at=r.last_login_at,
            comment_count=comment_counts.get(r.id, 0),
            bookmark_count=bookmark_counts.get(r.id, 0),
        )
        for r in rows
    ]
    return {
        "items": items,
        "pagination": {
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": (total + limit - 1) // limit if total > 0 else 0,
        },
    }


async def _get_reader_or_404(db: AsyncSession, reader_id: int) -> auth.ReaderAccount:
    reader = await db.get(auth.ReaderAccount, reader_id)
    if reader is None:
        raise HTTPException(status_code=404, detail="Reader not found")
    return reader


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/readers/{reader_id}/deactivate", response_model=AdminReaderStatusResponse)
async def admin_deactivate_reader(
    request: Request,  # noqa: ARG001
    reader_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Deactivate a reader account (admin only).

    Sets is_active=False and bumps token_version so every previously issued
    JWT dies immediately; the account can no longer sign in. Old tokens are
    rejected by get_current_reader and resolve to anonymous in optional-reader
    endpoints, so the trust-tier auto-approve path (DEC-098) cannot be gamed
    through a deactivated account. Idempotent: an already-inactive reader is
    not re-bumped.
    """
    reader = await _get_reader_or_404(db, reader_id)
    if reader.is_active:
        reader.is_active = False
        reader.token_version = (reader.token_version or 0) + 1
        await db.commit()
    return AdminReaderStatusResponse(
        id=reader.id,
        email=reader.email,
        is_active=False,
        last_login_at=reader.last_login_at,
    )


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/readers/{reader_id}/activate", response_model=AdminReaderStatusResponse)
async def admin_activate_reader(
    request: Request,  # noqa: ARG001
    reader_id: IdInt,
    db: AsyncSession = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    """Reactivate a deactivated reader account (admin only).

    The account can sign in again; token_version stays bumped from the
    deactivation, so the reader must obtain a fresh token (old ones remain
    revoked).
    """
    reader = await _get_reader_or_404(db, reader_id)
    if not reader.is_active:
        reader.is_active = True
        await db.commit()
    return AdminReaderStatusResponse(
        id=reader.id,
        email=reader.email,
        is_active=True,
        last_login_at=reader.last_login_at,
    )


@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
@router.post("/digests/send-weekly", response_model=dict)
async def admin_send_weekly_digest(
    request: Request,  # noqa: ARG001
    dry_run: bool = Query(False, description="Build + report without sending mail or stamping digest_sent_at"),
    _current_user: auth.User = Depends(get_current_superuser),
    db: AsyncSession = Depends(get_db),
):
    """Trigger the weekly email digest job on demand (DEC-201, TASK-222).

    Emails every reader who opted into the weekly digest; superuser-only
    because it is a broadcast. ``?dry_run=true`` reports exactly who/what would
    go out without delivering anything — the operator and e2e/verification
    lever. Returned summary: readers, emails_sent, posts, skipped, reason.
    """
    from app.digest import send_weekly_digest

    return await send_weekly_digest(db, dry_run=dry_run)
