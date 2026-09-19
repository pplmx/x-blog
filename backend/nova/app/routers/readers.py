"""Public reader profile endpoint (DEC-294, TASK-376).

Reader-attributed comments (DEC-062) serialize a verified reader profile
(id + display_name) on every public comment, but that identity was inert — the
display name was not clickable. This router gives a reader a public homepage:
GET /api/readers/{id} returns their public profile (display_name, join-date)
and their approved comments on publicly-visible posts, paginated. Deliberately
NO auth (public surface) and NO email (PII — same contract as
CommentReaderProfile).
"""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy.orm import Session

from app import auth, crud, schemas
from app.database import get_db
from app.limiter import RATE_LIMIT_READ, limiter
from app.schemas import PageInt

router = APIRouter(prefix="/api/readers", tags=["readers"])


def _naive(dt: datetime | None) -> datetime | None:
    """Normalize an aware DB timestamp to naive UTC (the naive-UTC wire
    contract, matching the components that emit CommentPublic.created_at)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return dt


class ReaderPublicProfile(BaseModel):
    """The public face of a reader account (never the email — PII)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str | None = None
    # Reader-written "about me" (round 352) — plain text, it is their own
    # public self-description by definition, so it is intentionally public.
    bio: str | None = None
    # Profile picture (DEC-299/TASK-378) — a public image URL, never PII.
    avatar_url: str | None = None
    # Opt-in public "Liked posts" tab (round 360, DEC-393): carrying the flag
    # on the profile lets the page render the tab only when the reader chose
    # to publish their likes (its likes endpoint 404s otherwise — no oracle
    # about what they like or why a tab is absent).
    public_likes: bool = False
    # Opt-in public "Saved posts" tab (round 363, DEC-399): the profile page
    # renders the tab only when the reader chose to publish their bookmarks
    # (the endpoint 404s otherwise — same no-oracle stance as public_likes).
    public_bookmarks: bool = False
    # Reader-to-reader follow (round 365, DEC-403): how many readers follow
    # this one — public, like an author-follow count. ``is_following`` is the
    # SIGNED-IN caller's own stance (false for guests / a caller not following),
    # so the profile header can render a Follow/Following button.
    follower_count: int = 0
    is_following: bool = False
    # Reader-block stance (round 379, DEC-425): whether the SIGNED-IN caller
    # has blocked this reader (false for guests / a caller who hasn't). Only
    # the caller's own block status — never the target's, never an inbox
    # graph — so the profile header can render a Block/Unblock toggle with the
    # same seeded-by-payload pattern as is_following.
    is_blocked: bool = False
    created_at: datetime | None = None

    @field_validator("created_at", mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        if isinstance(value, datetime):
            return _naive(value)
        return value


class ProfileCommentItem(schemas.CommentPublic):
    """A comment on the profile page plus the post it was left on, for
    navigation back (mirrors ReaderCommentItem in reader.py — the comment list
    is a comment history, and a post-less item is a dead-end)."""

    post: schemas.CommentPostBrief | None = None


class ReaderProfilePagination(BaseModel):
    total: int
    page: int
    limit: int
    total_pages: int


class ReaderProfilePage(BaseModel):
    profile: ReaderPublicProfile
    items: list[ProfileCommentItem]
    pagination: ReaderProfilePagination


class ReaderMentionSuggestion(BaseModel):
    """One '@'-mention picker suggestion — public identity only (never email)."""

    id: int
    display_name: str
    avatar_url: str | None = None


@router.get("/suggest", response_model=list[ReaderMentionSuggestion])
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def suggest_mention_readers(
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    query: str = Query("", max_length=50),
    db: Session = Depends(get_db),
):
    """Reader suggestions for the comment box's '@' picker (DEC-324, TASK-390).

    Declared before ``/{reader_id}`` so "suggest" is never parsed as an id.
    Public like the profile: id + display name + avatar, never the email. An
    empty query returns the first few named active readers so a bare '@' still
    has something to show.
    """
    rows = crud.suggest_mention_readers(db, query)
    return [ReaderMentionSuggestion(**row) for row in rows]


@router.get("/{reader_id}", response_model=ReaderProfilePage)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def reader_profile(
    reader_id: Annotated[int, Path(ge=1)],
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    current_reader: auth.ReaderAccount | None = Depends(auth.get_optional_reader),
    db: Session = Depends(get_db),
):
    """A reader's public homepage: display name, join date, and their approved
    comments on publicly-visible posts.

    Unknown reader -> 404 (a profile is only reachable by id that a comment
    actually carried, so a missing id is a broken link, not an empty page).
    The optional auth resolution is what lets the header render the caller's
    own Follow/Following state (round 365) while the page stays fully public.
    """
    reader = crud.get_reader_public_profile(db, reader_id)
    if reader is None:
        raise HTTPException(status_code=404, detail="Reader not found")

    comments, total = crud.list_reader_public_comments(db, reader_id, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    items = []
    for c in comments:
        base = schemas.CommentPublic.model_validate(c).model_dump()
        post = c.post  # joinedload in list_reader_public_comments
        items.append(
            ProfileCommentItem(
                **base,
                post=(schemas.CommentPostBrief(id=post.id, title=post.title, slug=post.slug) if post else None),
            )
        )
    profile_data = ReaderPublicProfile.model_validate(reader).model_dump()
    profile_data["follower_count"] = crud.count_reader_followers(db, reader_id)
    profile_data["is_following"] = current_reader is not None and crud.is_following_reader(
        db, current_reader.id, reader_id
    )
    profile_data["is_blocked"] = (
        current_reader is not None and crud.get_reader_block(db, current_reader.id, reader_id) is not None
    )
    return ReaderProfilePage(
        profile=ReaderPublicProfile(**profile_data),
        items=items,
        pagination=ReaderProfilePagination(
            total=total,
            page=page,
            limit=limit,
            total_pages=total_pages,
        ),
    )


@router.get("/{reader_id}/likes", response_model=schemas.PostListResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def reader_public_likes(
    reader_id: Annotated[int, Path(ge=1)],
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """A reader's liked posts, when they opted to publish them (round 360).

    The first reader-to-reader discovery surface: the profile page renders a
    "Liked posts" tab off this when ReaderPublicProfile.public_likes is true.
    Reuses the /me/likes listing (publicly-visible posts only, newest like
    first) but scoped to WWW (no auth). Opt-out = 404 for both unknown readers
    AND readers who didn't opt in — one indistinguishable answer, so the
    endpoint is not an oracle for "does this reader exist" or "what do they
    like" (same non-leak stance as the profile's missing-reader 404).
    """
    reader = crud.get_reader_public_profile(db, reader_id)
    if reader is None or not reader.public_likes:
        raise HTTPException(status_code=404, detail="Not found")
    posts, total = crud.list_reader_post_likes(db, reader_id, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    return schemas.PostListResponse.model_validate(
        {
            "items": [schemas.PostList.model_validate(p) for p in posts],
            "pagination": {
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": total_pages,
            },
        }
    )


@router.get("/{reader_id}/bookmarks", response_model=schemas.PostListResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def reader_public_bookmarks(
    reader_id: Annotated[int, Path(ge=1)],
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """A reader's saved posts, when they opted to publish them (round 363).

    The curated-reading counterpart to the liked-posts discovery surface: the
    profile page renders a "Saved posts" tab off this when
    ReaderPublicProfile.public_bookmarks is true. Bookmarks are an INTENTIONAL
    signal (a deliberate save — unlike passively auto-recorded reading
    history, which the private /history stays), so publishing them is
    privacy-clean when default off. Lists publicly-visible posts only (never a
    draft/scheduled post on a read path), newest save first. Opt-out = 404 for
    both unknown readers AND readers who didn't opt in — one indistinguishable
    answer (same non-leak stance as the likes endpoint).
    """
    reader = crud.get_reader_public_profile(db, reader_id)
    if reader is None or not reader.public_bookmarks:
        raise HTTPException(status_code=404, detail="Not found")
    posts, total = crud.list_reader_public_bookmarks(db, reader_id, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    return schemas.PostListResponse.model_validate(
        {
            "items": [schemas.PostList.model_validate(p) for p in posts],
            "pagination": {
                "total": total,
                "page": page,
                "limit": limit,
                "total_pages": total_pages,
            },
        }
    )
