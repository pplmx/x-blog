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

from app import crud, schemas
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


@router.get("/{reader_id}", response_model=ReaderProfilePage)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def reader_profile(
    reader_id: Annotated[int, Path(ge=1)],
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """A reader's public homepage: display name, join date, and their approved
    comments on publicly-visible posts.

    Unknown reader -> 404 (a profile is only reachable by id that a comment
    actually carried, so a missing id is a broken link, not an empty page).
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
    return ReaderProfilePage(
        profile=ReaderPublicProfile.model_validate(reader),
        items=items,
        pagination=ReaderProfilePagination(
            total=total,
            page=page,
            limit=limit,
            total_pages=total_pages,
        ),
    )
