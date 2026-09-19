"""Reader account endpoints: self-registration, login, current profile.

Reader accounts are the identity layer for cloud-synced bookmarks (DEC-059,
TASK-131). They are deliberately separate from admin ``User`` accounts — both
in table (``reader_accounts``) and in JWT audience (``aud=x-blog-reader``) —
so a self-registering reader can never hold a credential that reaches admin
endpoints (enforced in auth.get_current_user / get_current_reader).
"""

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path
from secrets import token_urlsafe
from typing import Annotated, Literal
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pyotp
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, status
from PIL import UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import auth, crud, emailer, models, schemas
from app.database import get_db
from app.image_validation import (
    ALLOWED_TYPES,
    ALLOWED_TYPES_MAP,
    MAX_SIZE,
    has_matching_magic_bytes,
    optimize_image,
    verify_image_decodes,
)
from app.limiter import RATE_LIMIT_AUTH, RATE_LIMIT_EXPORT, RATE_LIMIT_REGISTER, RATE_LIMIT_WRITE, limiter
from app.middleware import get_logger
from app.routers.comments import AUTO_APPROVE_READER_COMMENTS, _notify_comment_approved
from app.schemas import IdInt, NonNulStr, PageInt

logger = get_logger("reader")
router = APIRouter(prefix="/api/reader", tags=["reader"])

# RFC-5321-ish email shape; deliberately conservative and dependency-free
# (validated as a Field pattern so malformed input becomes the repo-standard
# 422 VALIDATION_ERROR envelope instead of a hand-rolled HTTPException).
# Uses \z (Rust-regex end-of-text anchor — Pydantic v2's engine — not Python
# $) so a trailing newline cannot sneak past the anchor. Shared with the
# anonymous comment write path via schemas.EMAIL_PATTERN (ISS-145).
_EMAIL_PATTERN = schemas.EMAIL_PATTERN


class ReaderProfile(BaseModel):
    """Public reader profile (never includes the password hash)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str | None = None
    # Short "about me" (round 352): reader-written plain text shown on their
    # public profile page; None until they write one.
    bio: str | None = None
    avatar_url: str | None = None
    # Opt-in publishing of the public "Liked posts" profile tab (round 360,
    # DEC-393) — false by default; a reader who likes being private stays so.
    public_likes: bool = False
    # Opt-in publishing of the public "Saved posts" profile tab (round 363,
    # DEC-399) — false by default, same privacy stance as public_likes.
    public_bookmarks: bool = False
    # Reader-owned 2FA flag (round 364, DEC-401): whether login demands a TOTP
    # second step. Exposed on the authenticated /me envelope only (the public
    # profile never carries it) so /account can render the state; the TOTP
    # secret itself is never serialized anywhere.
    two_factor_enabled: bool = False
    created_at: datetime | None = None


class ReaderLoginResponse(BaseModel):
    """Reader login result.

    The happy path carries ``access_token`` + ``reader``. When the reader has
    TOTP 2FA enabled (round 364, DEC-401) login carries NEITHER — only
    ``two_factor_required`` and the short-lived single-purpose ``mfa_token``
    that unlocks POST /login/2fa, where the code is exchanged for the real
    session. The extra optional fields are additive, so existing clients keep
    working unchanged on the single-step path.
    """

    access_token: str | None = None
    token_type: str | None = None
    reader: ReaderProfile | None = None
    two_factor_required: bool = False
    mfa_token: str | None = None


class ReaderLogin2FA(BaseModel):
    """Second step of a 2FA login: the challenge token + a TOTP code.

    ``mfa_token`` is only ever issued by POST /login for a 2FA-enabled reader;
    ``code`` is the current 6-digit authenticator code. Together they prove
    "knows the password" (mfa_token = post-password grant) AND "possesses the
    authenticator" (code), so the real access token can be issued."""

    mfa_token: Annotated[NonNulStr, Field(min_length=1, max_length=2048)]
    code: Annotated[NonNulStr, Field(min_length=6, max_length=8)]


class TwoFactorSetupResponse(BaseModel):
    """Fresh setup material for a reader enabling TOTP 2FA.

    ``secret`` is the base32 seed (never exposed again after enable);
    ``otpauth_uri`` is the provisioning URI an authenticator app or QR encodes."""

    secret: str
    otpauth_uri: str


class TwoFactorEnable(BaseModel):
    """Turn 2FA ON: the current password AND a valid code.

    Requiring the password at enrollment (not just a live session) is what
    stops a session thief from registering their OWN authenticator and locking
    the owner out — a stolen session alone cannot enable a factor only the
    account owner can verify (security review MEDIUM, DEC-401)."""

    current_password: str = Field(min_length=1, max_length=72)
    code: Annotated[NonNulStr, Field(min_length=6, max_length=8)]


class TwoFactorDisable(BaseModel):
    """Turn 2FA back off: the current password AND a valid code.

    Both are required so neither a stolen session alone nor a stolen password
    alone can silently drop the second factor (DEC-401)."""

    current_password: str = Field(min_length=1, max_length=72)
    code: Annotated[NonNulStr, Field(min_length=6, max_length=8)]


class ReaderRegister(BaseModel):
    email: Annotated[NonNulStr, Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)]
    # bcrypt only hashes the first 72 bytes of a password; capping input at 72
    # keeps the effective credential equal to the stored credential (a longer
    # password would silently truncate). (security review, TASK-131)
    password: str = Field(min_length=8, max_length=72)
    display_name: Annotated[NonNulStr | None, Field(default=None, min_length=1, max_length=50)] = None

    @field_validator("display_name", mode="before")
    @classmethod
    def strip_display_name(cls, value: object) -> object:
        # Whitespace-only display_name passed min_length=1 (Pydantic counts raw
        # chars) and then rendered as a blank comment/feed author name
        # (crud uses display_name as the comment/author nickname, ISS-456).
        # Strip before length validation so "   " becomes "" and fails the
        # same min_length=1 gate the rest of the name fields enforce.
        return schemas._strip_blank(value) if isinstance(value, str) else value


class ReaderLogin(BaseModel):
    email: Annotated[NonNulStr, Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)]
    password: str = Field(min_length=1, max_length=72)


class BookmarkItem(BaseModel):
    """A bookmarked post as serialized to the reader's bookmark list.

    Mirrors the frontend ``Bookmark`` shape (useBookmarks.ts) so the cloud list
    and the localStorage list serialize identically and the client can merge
    them transparently. Carries the optional folder_id/folder_name (DEC-120/
    TASK-172) so the client can render grouping. Deliberately omits full
    content/views/likes — a bookmark list is a navigation list, not a dump.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    slug: str
    excerpt: str | None = None
    cover_image: str | None = None
    created_at: datetime | None = None
    folder_id: int | None = None
    folder_name: str | None = None
    # Queue state (round 361, DEC-395): false = To-read, true = Done.
    done: bool = False
    category: schemas.Category | None = None
    tags: list[schemas.Tag] = []

    @classmethod
    def from_post(
        cls,
        post: models.Post,
        folder_id: int | None = None,
        folder_name: str | None = None,
        done: bool = False,
    ) -> BookmarkItem:
        """Build from a Post row (created_at is the post's, not the bookmark's).

        Category/tags are copied into the public schema shapes (the model rows
        carry ORM instances and would leak through from_attributes otherwise).
        """
        return cls(
            id=post.id,
            title=post.title,
            slug=post.slug,
            excerpt=post.excerpt,
            cover_image=post.cover_image,
            created_at=post.created_at,
            folder_id=folder_id,
            folder_name=folder_name,
            done=done,
            category=(schemas.Category.model_validate(post.category) if post.category else None),
            tags=[schemas.Tag.model_validate(t) for t in post.tags],
        )


class BookmarkListResponse(BaseModel):
    items: list[BookmarkItem]
    total: int
    page: int = 1
    limit: int = 100
    total_pages: int = 0


class BookmarkFolderItem(BaseModel):
    """A reader's bookmark folder with its saved-post count (DEC-120)."""

    id: int
    name: str
    count: int = 0


class BookmarkFolderListResponse(BaseModel):
    items: list[BookmarkFolderItem]
    total: int


class FolderCreate(BaseModel):
    name: Annotated[NonNulStr, Field(min_length=1, max_length=50)]

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value: object) -> object:
        # Whitespace-only name passed min_length=1 and was later stored as ""
        # by crud.create_bookmark_folder's strip (a blank folder in the list,
        # ISS-456). Strip at the boundary like every other name field so
        # "   " is rejected as 422 before it can reach storage.
        return schemas._strip_blank(value) if isinstance(value, str) else value


class FolderRename(BaseModel):
    name: Annotated[NonNulStr, Field(min_length=1, max_length=50)]

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value: object) -> object:
        return schemas._strip_blank(value) if isinstance(value, str) else value


class AssignFolder(BaseModel):
    # None clears the bookmark's folder.
    folder_id: int | None = None


class BookmarkFolderResponse(BaseModel):
    id: int
    name: str


class AssignFolderResponse(BaseModel):
    post_id: int
    folder_id: int | None = None


class BookmarkDone(BaseModel):
    """Move a bookmark between To-read and Done (round 361, DEC-395)."""

    done: bool


class BookmarkDoneResponse(BaseModel):
    post_id: int
    done: bool


class SeriesProgressResponse(BaseModel):
    """A reader's progress through a series, derived from their history
    (DEC-122/TASK-173). ``next_slug`` is the first unread post in series order,
    or None when the series is fully read/empty.
    """

    series_slug: str
    series_title: str
    total: int = 0
    read_count: int = 0
    completed: bool = False
    read_post_ids: list[int] = []
    next_slug: str | None = None


class DataExportResponse(BaseModel):
    """A reader's portable data bundle (DEC-126/TASK-175; completed DEC-334).

    Now covers every reader-owned dataset: profile, bookmarks, comments,
    history, likes (round 359/360), follows (category/tag/series),
    notification preferences, the durable inbox rows, and push-subscription
    device summaries (endpoints + created_at only — never the cryptographic
    keys). Nothing cross-reader.
    """

    account: dict
    exported_at: str | None = None
    bookmarks: list[dict] = []
    comments: list[dict] = []
    history: list[dict] = []
    likes: list[dict] = []
    follows: dict = {}
    notification_prefs: dict | None = None
    notifications: list[dict] = []
    push_subscriptions: list[dict] = []


class FollowedSeriesItem(BaseModel):
    """A series the reader follows (DEC-132/TASK-178; notify control TASK-181)."""

    id: int
    title: str
    slug: str
    description: str | None = None
    notify: bool


class FollowedSeriesListResponse(BaseModel):
    items: list[FollowedSeriesItem]
    total: int


class SeriesFollowResponse(BaseModel):
    series_id: int
    series_slug: str
    following: bool
    notify: bool


class FollowedCategoryItem(BaseModel):
    """A category the reader follows (DEC-140/TASK-182)."""

    id: int
    name: str
    notify: bool


class FollowedCategoryListResponse(BaseModel):
    items: list[FollowedCategoryItem]
    total: int


class CategoryFollowResponse(BaseModel):
    category_id: int
    category_name: str
    following: bool
    notify: bool


class CategoryFollowNotifyUpdate(BaseModel):
    """Body for toggling per-category new-post notifications (TASK-182)."""

    notify: bool


class FollowedTagItem(BaseModel):
    """A tag the reader follows (DEC-195/TASK-215)."""

    id: int
    name: str
    notify: bool


class FollowedTagListResponse(BaseModel):
    items: list[FollowedTagItem]
    total: int


class TagFollowResponse(BaseModel):
    tag_id: int
    tag_name: str
    following: bool
    notify: bool


class TagFollowNotifyUpdate(BaseModel):
    """Body for toggling per-tag new-post notifications (TASK-215)."""

    notify: bool


class FollowedAuthorItem(BaseModel):
    """A writer the reader follows (round 353).

    Public identity only: the pen name + follow id + notify state. Never the
    login username (admin login is no-oracle).
    """

    author_id: int
    display_name: str
    notify: bool


class FollowedAuthorListResponse(BaseModel):
    items: list[FollowedAuthorItem]
    total: int


class AuthorFollowResponse(BaseModel):
    author_id: int
    display_name: str
    following: bool
    notify: bool


class AuthorFollowNotifyUpdate(BaseModel):
    """Body for toggling per-author new-post notifications (round 353)."""

    notify: bool


class FollowedReaderItem(BaseModel):
    """A reader the reader follows (round 365).

    Public identity only, like the author-follow item: display name + avatar,
    never the email. ``display_name`` may be null (a reader who never set one)
    — the account page falls back to the anonymous label the profile shows."""

    reader_id: int
    display_name: str | None = None
    avatar_url: str | None = None
    notify: bool


class FollowedReaderListResponse(BaseModel):
    items: list[FollowedReaderItem]
    total: int


class ReaderFollowResponse(BaseModel):
    reader_id: int
    display_name: str | None = None
    following: bool
    notify: bool


class BlockedReaderItem(BaseModel):
    """A reader this reader has blocked (round 379, DEC-425).

    Public identity only, like the follow item: display name + avatar, never
    the email, plus when the block was placed (for the management list). The
    blocked reader is never told — this surface is only the blocker's own."""

    reader_id: int
    display_name: str | None = None
    avatar_url: str | None = None
    blocked_at: datetime | None = None


class BlockedReaderListResponse(BaseModel):
    items: list[BlockedReaderItem]
    total: int


class AddBookmarkResponse(BaseModel):
    post_id: int
    # True when the bookmark was newly created, False when it already existed
    # (idempotent re-put during merge). Lets the client skip a redundant sync.
    already_existed: bool


class SubscribedThreadItem(BaseModel):
    """A followed comment thread as serialized to the reader's account list.

    Same navigation-list shape as BookmarkItem (title/slug/cover/taxonomy,
    no full content dump) — the reader needs to identify and open the post,
    not re-read it here.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    slug: str
    excerpt: str | None = None
    cover_image: str | None = None
    category: schemas.Category | None = None
    tags: list[schemas.Tag] = []

    @classmethod
    def from_post(cls, post: models.Post) -> SubscribedThreadItem:
        return cls(
            id=post.id,
            title=post.title,
            slug=post.slug,
            excerpt=post.excerpt,
            cover_image=post.cover_image,
            category=(schemas.Category.model_validate(post.category) if post.category else None),
            tags=[schemas.Tag.model_validate(t) for t in post.tags],
        )


class SubscribedThreadListResponse(BaseModel):
    items: list[SubscribedThreadItem]
    total: int
    page: int = 1
    limit: int = 100
    total_pages: int = 0


class ReadingHistoryItem(BaseModel):
    """A viewed post as serialized to the reader's reading-history page.

    Navigation-list shape (post summary) plus the last ``viewed_at`` so the UI
    can render when the post was read. Omits the full body/views/likes — a
    history page is a jump-back list, like the bookmark list.
    """

    id: int
    title: str
    slug: str
    excerpt: str | None = None
    cover_image: str | None = None
    viewed_at: datetime | None = None
    category: schemas.Category | None = None
    tags: list[schemas.Tag] = []

    @classmethod
    def from_post(cls, post: models.Post, viewed_at: datetime | None) -> ReadingHistoryItem:
        return cls(
            id=post.id,
            title=post.title,
            slug=post.slug,
            excerpt=post.excerpt,
            cover_image=post.cover_image,
            viewed_at=viewed_at,
            category=(schemas.Category.model_validate(post.category) if post.category else None),
            tags=[schemas.Tag.model_validate(t) for t in post.tags],
        )


class ReadingHistoryListResponse(BaseModel):
    items: list[ReadingHistoryItem]
    total: int
    # Pagination metadata (mirrors ReaderCommentListResponse, DEC-102).
    page: int = 1
    limit: int = 20
    total_pages: int = 1


class RecordHistoryResponse(BaseModel):
    post_id: int
    # True when the history row already existed and only viewed_at refreshed
    # (idempotent upsert); the client can ignore it.
    already_existed: bool


class RecordHistoryRequest(BaseModel):
    """Optional body on the view-record endpoint (DEC-167/TASK-200).

    A plain view (no body) preserves the previously saved ``scroll_position``;
    the client sends an explicit value only when updating the reader's resume
    position. ``0`` is a valid offset (scrolled to the very top) and clears the
    saved position. Bounded so a misbehaving client cannot store absurd pixels.
    ``scroll_fraction`` (DEC-346/TASK-399) is the cross-viewport resume
    position as a 0..1 fraction of the document height, saved alongside the
    pixel; bounded to the unit interval.
    """

    scroll_position: int | None = Field(default=None, ge=0, le=10_000_000)
    scroll_fraction: float | None = Field(default=None, ge=0, le=1)


class ReadingPositionResponse(BaseModel):
    """A reader's saved resume offset for a post, for the post page to restore
    on return (null when the post has never been viewed).

    ``scroll_fraction`` is the cross-viewport fraction (DEC-346, TASK-399),
    null for pre-feature rows — the client falls back to ``scroll_position``.
    """

    post_id: int
    scroll_position: int | None = None
    scroll_fraction: float | None = None


class DayActivity(BaseModel):
    """One day's reads for the 52-week activity heatmap (DEC-169/TASK-201).

    ``date`` is the reader's local calendar date (ISO yyyy-mm-dd; UTC when no
    timezone was requested, DEC-316); ``count`` is how many publicly visible
    posts were read that day (0 days included so the heatmap renders without
    gaps).
    """

    date: str
    count: int


class ReadingStatsResponse(BaseModel):
    """A reader's reading summary derived from their history (DEC-118).

    Publicly-visible posts only — un-published posts neither leak nor count.
    ``recent`` mirrors the history-list item shape for continue-reading quick
    jumps. ``current_streak`` / ``longest_streak`` / ``activity`` power the
    gamification surface (DEC-169): the streak in consecutive active days —
    anchored to the reader's local calendar when a timezone was sent, UTC
    otherwise (DEC-316) — and the last 52 weeks of per-day read counts.
    """

    total_posts: int = 0
    total_reading_minutes: int = 0
    last_viewed_at: datetime | None = None
    recent: list[ReadingHistoryItem] = []
    current_streak: int = 0
    longest_streak: int = 0
    activity: list[DayActivity] = []


class CategoryReadCount(BaseModel):
    """A category name plus how many distinct posts of it the reader has read
    (reading insights, DEC-417/TASK-434)."""

    name: str
    count: int


class ReadingInsightsResponse(BaseModel):
    """Aggregated reading insights for the signed-in reader (DEC-417/TASK-434).

    Complements the streak/heatmap (which show the calendar *shape* of reading)
    with the *content* shape: how much was read all-time and recently, and
    which categories dominate. Publicly-visible posts only — un-published posts
    neither leak nor count. One row per reader-post in ReadingHistory, so
    repeat visits on the same post count once.
    """

    grand_total: int = 0
    last_30_days: int = 0
    top_categories: list[CategoryReadCount] = []


# A valid bcrypt hash of a random throwaway password, at the same cost as a
# real account hash. When the email is unknown we still run bcrypt against this
# so the login endpoint's response *timing* does not reveal whether an email
# exists (unknown email must not short-circuit faster than a wrong password).
_FAKE_BCRYPT_HASH = "$2b$12$K7LqkVaQ1OiOsahF1P17/uM5UQi7QkS5d8ZqS3mDzW0yPj2k9VxG"


def _authenticate_reader(db: Session, email: str, password: str) -> auth.ReaderAccount | None:
    """Return the reader account for valid credentials, else None.

    Runs bcrypt against a dummy hash for unknown emails so timing does not
    leak account existence (login is reusable abuse surface even though
    registration is an existence oracle with a stricter rate limit).
    """
    reader = db.query(auth.ReaderAccount).filter(func.lower(auth.ReaderAccount.email) == email.lower()).first()
    if not reader:
        auth.verify_password(password, _FAKE_BCRYPT_HASH)
        return None
    if not auth.verify_password(password, reader.password):
        return None
    return reader


def _reject_inactive(reader: auth.ReaderAccount) -> None:
    """Block a deactivated reader from signing in (DEC-194, TASK-214).

    The trust tier auto-approves verified readers' comments (DEC-098), so an
    operator-deactivated account must not be able to mint a fresh session at
    all — the 403 mirrors get_current_reader's rejection of their old tokens.
    """
    if reader.is_active is False:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account deactivated",
        )


@router.post("/register", response_model=ReaderLoginResponse, status_code=201)
@limiter.limit(f"{RATE_LIMIT_REGISTER}/minute")
def register(
    request: Request,  # noqa: ARG001
    payload: ReaderRegister,
    db: Session = Depends(get_db),
):
    """Create a reader account and return a reader-scoped JWT (auto-login).

    Registration is rate-limited by a dedicated (stricter) per-IP bucket than
    login, since open signup is the classic spam/abuse surface.
    """
    # Normalize to lowercase so the case-sensitive unique index on `email` is
    # effectively case-insensitive: "Reader@X.com" and "reader@x.com" must not
    # be two accounts, and login (which compares with func.lower) stays
    # unambiguous. (DEC-059, TASK-131)
    normalized_email = payload.email.lower().strip()
    reader = auth.ReaderAccount(
        email=normalized_email,
        password=auth.get_password_hash(payload.password),
        display_name=payload.display_name,
        token_version=0,
    )
    db.add(reader)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already registered")
    db.refresh(reader)

    reader.last_login_at = datetime.now(UTC)
    db.commit()
    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(reader),
    }


@router.post("/login", response_model=ReaderLoginResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def login(
    request: Request,  # noqa: ARG001
    payload: ReaderLogin,
    db: Session = Depends(get_db),
):
    """Authenticate a reader by email+password and return a reader-scoped JWT.

    A reader with TOTP 2FA enabled (round 364, DEC-401) is NOT given an access
    token here: the first step only proves the password, so the response carries
    a short-lived single-purpose ``mfa_token`` (and ``two_factor_required``)
    that the second step (POST /login/2fa) exchanges for the real session.
    ``last_login_at`` is deliberately not bumped on the first step for 2FA
    readers — the account is only "logged in" once the code is proven.
    """
    reader = _authenticate_reader(db, payload.email, payload.password)
    if reader is None:
        # Same detail string as admin login so the response doesn't reveal
        # whether an email exists.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Operator-deactivated accounts cannot sign in again (DEC-194, TASK-214).
    _reject_inactive(reader)
    if reader.two_factor_enabled:
        return {
            "two_factor_required": True,
            "mfa_token": auth.create_reader_2fa_token(reader.id, token_version=reader.token_version or 0),
        }
    reader.last_login_at = datetime.now(UTC)
    db.commit()
    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(reader),
    }


@router.post("/login/2fa", response_model=ReaderLoginResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def login_2fa(
    request: Request,  # noqa: ARG001
    payload: ReaderLogin2FA,
    db: Session = Depends(get_db),
):
    """Second step of a 2FA login: exchange a challenge token + TOTP code for a
    real reader session.

    ``mfa_token`` is honored only if POST /login issued it moments ago and it
    still matches the reader's current ``token_version``; ``code`` must be the
    Nth 6-digit authenticator code for the stored seed. Any failure (bogus/
    expired/stale challenge, wrong code) is one indistinguishable 401 — no
    oracle for which part failed, so an attacker learns nothing about whether
    the email or the code was wrong. (DEC-401)
    """
    reader = auth.get_reader_for_2fa(payload.mfa_token, db)
    # One INDISTINGUISHABLE 401 for every failure mode — a bogus/expired/stale
    # challenge AND a wrong code both land here with the same body, so an
    # attacker who stole an mfa_token learns nothing about whether it is still
    # live (security-review MEDIUM, DEC-401; the combined short-circuit also
    # means the code is only verified once a valid challenge names a reader).
    if reader is None or not auth.verify_totp(reader.two_factor_secret or "", payload.code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired login attempt",
            headers={"WWW-Authenticate": "Bearer"},
        )
    reader.last_login_at = datetime.now(UTC)
    db.commit()
    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(reader),
    }


@router.get("/me", response_model=ReaderProfile)
def me(_current_reader: auth.ReaderAccount = Depends(auth.get_current_reader)):
    """Return the authenticated reader's own profile."""
    return _current_reader


class ReaderProfileUpdate(BaseModel):
    """Editable reader profile fields. Email is NOT editable here: it is the
    login identity, so it lives on its own verified flow (DEC-357,
    /me/email/request + /me/email/confirm) rather than a silent reassignment."""

    display_name: Annotated[NonNulStr | None, Field(default=None, min_length=1, max_length=50)] = None
    # Plain-text "about me" (round 352); None = no update, explicit null =
    # clear. Bounded so one request cannot bloat the account row unbounded.
    bio: Annotated[NonNulStr | None, Field(default=None, max_length=500)] = None
    # Opt-in publishing of the public "Liked posts" profile tab (round 360,
    # DEC-393); explicit true/false only (exclude_unset contract below).
    public_likes: bool | None = None
    # Opt-in publishing of the public "Saved posts" profile tab (round 363,
    # DEC-399); explicit true/false only (exclude_unset contract below).
    public_bookmarks: bool | None = None

    @field_validator("display_name", mode="before")
    @classmethod
    def strip_display_name(cls, value: object) -> object:
        # Same blank guard as registration: "   " must not become a stored
        # display_name that renders as a blank author name (ISS-456). None (no
        # update) passes through untouched — only non-None strings are stripped.
        return schemas._strip_blank(value) if isinstance(value, str) else value

    @field_validator("bio", mode="before")
    @classmethod
    def strip_bio(cls, value: object) -> object:
        # A whitespace-only bio is an empty bio: fold it to None (which under
        # exclude_unset still counts as an explicit clear on save).
        stripped = schemas._strip_blank(value) if isinstance(value, str) else value
        return stripped or None


class ReaderPasswordChange(BaseModel):
    """Password rotation: verify the current one, set a new one.

    new_password bounds mirror registration (bcrypt only hashes the first 72
    bytes — equality between effective and stored credential requires the same
    cap on both ends, security review TASK-131)."""

    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class ReaderEmailChangeRequest(BaseModel):
    """Start an email change: the new login address + the current password.

    The password proves control of the account now; ownership of the NEW
    address is proven separately by the emailed verification link
    (DEC-357/TASK-404). Same email shape/bounds as registration."""

    new_email: Annotated[NonNulStr, Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)]
    current_password: str = Field(min_length=1, max_length=254)

    @field_validator("new_email", mode="before")
    @classmethod
    def strip_new_email(cls, value: object) -> object:
        # Whitespace-only / padded input is normalized before pattern+length
        # validation (same blank guard as registration).
        return schemas._strip_blank(value) if isinstance(value, str) else value


class ReaderEmailChangeConfirm(BaseModel):
    token: Annotated[NonNulStr, Field(max_length=128)]


class ReaderPasswordChangeResponse(BaseModel):
    access_token: str
    token_type: str
    reader: ReaderProfile


class ReaderPasswordResetRequest(BaseModel):
    """Body for requesting a password-reset link (forgot-password).

    Only the email. The response is deliberately account-agnostic: the endpoint
    always returns the same success body whether or not the address maps to an
    account, so the endpoint is not an account-existence oracle (the register
    oracle hardening DEC-060 flagged)."""

    email: Annotated[NonNulStr, Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)]


class ReaderPasswordResetConfirm(BaseModel):
    """Body for redeeming a password-reset token.

    ``new_password`` bounds mirror registration/rotation (bcrypt only hashes the
    first 72 bytes — equality between effective and stored credential requires
    the same cap on both ends, security review TASK-131)."""

    token: str = Field(min_length=1, max_length=2048)
    new_password: str = Field(min_length=8, max_length=72)


class ReaderPushSubscriptionItem(BaseModel):
    """One push subscription bound to the reader (device management view).

    Deliberately excludes the encryption keys (p256dh/auth/endpoint-fragment)
    — the client only needs identity + age + new-post prefs to decide what to
    revoke or how to steer follows (DEC-076, TASK-147)."""

    id: int
    endpoint: str
    created_at: datetime | None = None
    want_new_posts: bool = False
    new_post_category_id: int | None = None


class ReaderPushSubscriptionUpdate(BaseModel):
    """New-post notification prefs for one of the reader's devices."""

    want_new_posts: bool = False
    new_post_category_id: int | None = None


class ReaderPushSubscriptionListResponse(BaseModel):
    items: list[ReaderPushSubscriptionItem]
    total: int


@router.patch("/me", response_model=ReaderProfile)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def update_my_profile(
    request: Request,  # noqa: ARG001
    payload: ReaderProfileUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Update the reader's own profile (display_name, bio). Email changes are
    their own verified flow (/me/email/request + /me/email/confirm, DEC-357)."""
    if payload.display_name is not None:
        current_reader.display_name = payload.display_name
    # Bio is the one field that can be cleared (None), so it follows the
    # exclude_unset contract: only an explicitly-present key is applied.
    if "bio" in payload.model_dump(exclude_unset=True):
        current_reader.bio = payload.bio
    # The public-likes opt-in is boolean and unambiguous — apply it whenever
    # present, keeping the exclude_unset discipline (a PATCH that only touches
    # display_name must not flip the flag).
    if "public_likes" in payload.model_dump(exclude_unset=True):
        current_reader.public_likes = bool(payload.public_likes)
    # The public-bookmarks opt-in (round 363, DEC-399) mirrors public_likes —
    # applied only when explicitly present.
    if "public_bookmarks" in payload.model_dump(exclude_unset=True):
        current_reader.public_bookmarks = bool(payload.public_bookmarks)
    db.commit()
    db.refresh(current_reader)
    return current_reader


# Reader avatar storage lives in a dedicated static/avatars/ namespace, NOT the
# admin media library's static/uploads/ (DEC-299/TASK-378): the admin media
# listing walks static/uploads/ only, so a reader's profile picture must not
# appear in or collide with the author's uploaded post images.
AVATAR_DIR = Path(__file__).parent.parent.parent / "static" / "avatars"
# Avatars are stored as `{uuid4}.{ext}` (same shape as media uploads); the
# remove route whitelists the exact shape so a DB value can never become a
# filesystem path outside the avatar dir (mirrors upload.py's _FILENAME_RE).
_AVATAR_FILENAME_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$"
)


def _delete_avatar_file(avatar_url: str | None) -> None:
    """Best-effort delete of a stored avatar file, given its /static URL.

    Only ever removes a file whose name matches the exact avatar shape (so a
    corrupted/foreign avatar_url value can't be turned into a filesystem path
    — path-traversal guard, same discipline as upload.py). A missing file is
    fine — the URL is the source of truth and a stale row shouldn't fail the
    write that cleans it up.
    """
    if not avatar_url:
        return
    name = avatar_url.rsplit("/", 1)[-1]
    if not _AVATAR_FILENAME_RE.match(name):
        return
    path = AVATAR_DIR / name
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("could not remove stale avatar file %s", path)


@router.post("/me/avatar", response_model=ReaderProfile)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
async def upload_my_avatar(
    request: Request,  # noqa: ARG001
    file: UploadFile = File(...),
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Set the reader's profile picture (replaces any existing one).

    Same defense-in-depth validation as the admin image upload (content-type
    whitelist, size cap, magic bytes, full Pillow decode, never-larger re-encode
    that strips EXIF) — shared via app.image_validation so the two upload
    surfaces can't drift apart (DEC-299/TASK-378). The new avatar is written to
    static/avatars/ first, then the DB row is updated and any previous avatar
    file removed, so a failed write never leaves a dangling avatar_url.
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

    ext = ALLOWED_TYPES_MAP.get(file.content_type, "jpg")
    filename = f"{uuid4()}.{ext}"
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    filepath = AVATAR_DIR / filename
    filepath.write_bytes(contents)

    avatar_url = f"/static/avatars/{filename}"
    previous = current_reader.avatar_url
    current_reader.avatar_url = avatar_url
    db.commit()
    db.refresh(current_reader)
    _delete_avatar_file(previous)
    return current_reader


@router.delete("/me/avatar", response_model=ReaderProfile)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def remove_my_avatar(
    request: Request,  # noqa: ARG001
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Remove the reader's profile picture (stored file + DB row)."""
    previous = current_reader.avatar_url
    if previous:
        current_reader.avatar_url = None
        db.commit()
        db.refresh(current_reader)
        _delete_avatar_file(previous)
    return current_reader


@router.post("/me/password", response_model=ReaderPasswordChangeResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def change_my_password(
    request: Request,  # noqa: ARG001
    payload: ReaderPasswordChange,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Rotate the reader's password, revoking all other sessions.

    Verifies the current password (same timing-safe helper as login), then
    bumps ``token_version`` so every pre-change reader JWT is rejected, and
    returns a fresh token for this session. Rate-limited like login.
    """
    if not auth.verify_password(payload.current_password, current_reader.password):
        raise HTTPException(status_code=401, detail="Incorrect current password")
    current_reader.password = auth.get_password_hash(payload.new_password)
    current_reader.token_version = (current_reader.token_version or 0) + 1
    db.commit()
    db.refresh(current_reader)

    access_token = auth.create_reader_token({"sub": current_reader.id}, token_version=current_reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(current_reader),
    }


@router.post("/me/2fa/setup", response_model=TwoFactorSetupResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def setup_two_factor(
    request: Request,  # noqa: ARG001
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Generate fresh TOTP enrollment material (round 364, DEC-401).

    Returns a new base32 secret + an otpauth:// provisioning URI (for an
    authenticator QR or manual entry). Nothing is ENABLED yet — the reader must
    prove possession via /me/2fa/enable. A repeat call before enabling simply
    generates a fresh secret (the previous enrollment is discarded); once
    enabled the secret is never re-exposed and this endpoint 409s.
    """
    if current_reader.two_factor_enabled:
        raise HTTPException(status_code=409, detail="Two-factor authentication is already enabled")
    secret = pyotp.random_base32()
    current_reader.two_factor_secret = secret
    db.commit()
    otpauth_uri = pyotp.TOTP(secret).provisioning_uri(name=current_reader.email, issuer_name="X-Blog")
    return {"secret": secret, "otpauth_uri": otpauth_uri}


@router.post("/me/2fa/enable", response_model=ReaderProfile)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def enable_two_factor(
    request: Request,  # noqa: ARG001
    payload: TwoFactorEnable,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Prove the account AND the authenticator, then turn 2FA on.

    The current password is verified first (a session alone must not be able to
    enroll a factor the owner can't remove — security review MEDIUM, DEC-401),
    then the single code must match the stored seed. Either failure is a flat
    400 with no hint of which half was wrong. Once enabled, POST /login starts
    returning an mfa_token instead of an access token. Existing sessions stay
    valid — enabling a second factor does not log the reader out.
    """
    if not auth.verify_password(payload.current_password, current_reader.password):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    if current_reader.two_factor_enabled:
        raise HTTPException(status_code=409, detail="Two-factor authentication is already enabled")
    if not current_reader.two_factor_secret:
        raise HTTPException(status_code=400, detail="Run /me/2fa/setup first")
    if not auth.verify_totp(current_reader.two_factor_secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid authentication code")
    current_reader.two_factor_enabled = True
    db.commit()
    return current_reader


@router.post("/me/2fa/disable", response_model=ReaderProfile)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def disable_two_factor(
    request: Request,  # noqa: ARG001
    payload: TwoFactorDisable,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Turn 2FA back off — only with the current password AND a valid code.

    Both are required so neither a stolen session alone nor a stolen password
    alone can silently drop the second factor. On success the seed is cleared,
    so enrollment must restart from /me/2fa/setup.
    """
    if not auth.verify_password(payload.current_password, current_reader.password):
        raise HTTPException(status_code=400, detail="Incorrect current password")
    if not current_reader.two_factor_enabled or not current_reader.two_factor_secret:
        raise HTTPException(status_code=400, detail="Two-factor authentication is not enabled")
    if not auth.verify_totp(current_reader.two_factor_secret, payload.code):
        raise HTTPException(status_code=400, detail="Invalid authentication code")
    current_reader.two_factor_enabled = False
    current_reader.two_factor_secret = None
    db.commit()
    return current_reader


#: Time-to-live of an email-change verification link (mirrors the password-reset
#: window: long enough to reach the new inbox, short enough to expire stale
#: links). The pending change is cleared when it lapses (DEC-357, TASK-404).
EMAIL_CHANGE_TTL_MINUTES = 60


@router.post("/me/email/request", status_code=202)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def request_email_change(
    request: Request,  # noqa: ARG001
    payload: ReaderEmailChangeRequest,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Start an email change: prove the account, then email a link to the NEW
    address.

    This is the authenticated half (DEC-357/TASK-404): the requester must prove
    control of the account via the current password (401 otherwise) and the NEW
    address is proven by the emailed verification link. Not an existence oracle
    — the endpoint is behind ``get_current_reader``, so it is never anonymously
    reachable. A new address already used by another account is 409 (mirroring
    register). SMTP unconfigured / send failed is a 503 (a change without the
    verification mail cannot complete), and nothing is persisted then. A repeat
    request replaces the previous pending change (single active flow).
    """
    if not auth.verify_password(payload.current_password, current_reader.password):
        raise HTTPException(status_code=401, detail="Incorrect current password")
    new_email = payload.new_email.strip().lower()
    if new_email == current_reader.email:
        raise HTTPException(status_code=400, detail="New email must differ from the current email")
    occupied = (
        db.query(auth.ReaderAccount)
        .filter(func.lower(auth.ReaderAccount.email) == new_email, auth.ReaderAccount.id != current_reader.id)
        .first()
    )
    if occupied is not None:
        raise HTTPException(status_code=409, detail="That email is already in use by another account")
    if not emailer.is_email_configured():
        raise HTTPException(status_code=503, detail="Email service is not configured on this server")

    token = token_urlsafe(32)
    current_reader.email_change_token = token
    current_reader.email_change_pending = new_email
    current_reader.email_change_requested_at = crud.utc_now_naive()
    # Persist BEFORE sending (round 393): an email sent in front of an
    # uncommitted token leaves the reader holding a dead link if the commit
    # then fails (transient DB error) — the confirm step would find no row by
    # that token. On a send failure the just-persisted pending row is cleared
    # again (best-effort), so the "nothing staged on failure" guarantee holds
    # as before; a stale row that slips through self-expires via the
    # EMAIL_CHANGE_TTL_MINUTES and is overwritten on the next re-request.
    db.commit()

    def _clear_pending() -> None:
        current_reader.email_change_token = None
        current_reader.email_change_pending = None
        current_reader.email_change_requested_at = None
        db.commit()

    try:
        accepted = emailer.send_email_change_email(new_email, token)
        if not accepted:
            # RFC-level refusal (e.g. the address provably bounces): nothing
            # staged, exactly as before the reorder.
            _clear_pending()
            raise HTTPException(
                status_code=503,
                detail="Could not send the verification email, please try again later",
            )
    except HTTPException:
        raise
    except Exception:
        logger.exception("email-change verification send raised")
        try:
            _clear_pending()
        except Exception:  # noqa: BLE001 — never mask the primary 503
            db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Could not send the verification email, please try again later",
        ) from None
    return {"message": "A verification link is on its way to the new address"}


@router.post("/me/email/confirm", response_model=ReaderLoginResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def confirm_email_change(
    request: Request,  # noqa: ARG001
    payload: ReaderEmailChangeConfirm,
    db: Session = Depends(get_db),
):
    """Redeem the emailed verification token: swap the reader's login email.

    No auth — the emailed link IS the credential. One-time: the pending state
    is cleared on success, so a second click finds nothing and answers 400,
    indistinguishable from an invalid/expired link (mirroring password-reset
    confirm). On success the email is swapped, ``token_version`` is bumped
    (revoking every pre-change session, mirroring password change) and a
    fresh auto-login session is returned. If the target address was taken by
    another account while the link sat pending, the stale change is cleared and
    confirm answers 409 (the reader re-requests the change).

    The redeem itself is an atomic conditional UPDATE (WHERE the stored token
    is still the one presented), so concurrent confirms of the same link and a
    confirm racing a re-request cannot both win: the loser's UPDATE matches no
    row and answers 400 like any spent link. A target registered in the few
    microseconds after the occupied check trips the unique email index, which
    is caught and surfaced as the business 409 (register uses the same
    IntegrityError -> conflict pattern) instead of a 500 (round-342 review).
    """
    reader = db.query(auth.ReaderAccount).filter(auth.ReaderAccount.email_change_token == payload.token).first()
    if reader is None or reader.email_change_pending is None:
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")

    now = crud.utc_now_naive()
    if reader.email_change_requested_at is None or now - reader.email_change_requested_at > timedelta(
        minutes=EMAIL_CHANGE_TTL_MINUTES
    ):
        # Expired — clear the stale pending so a re-request starts clean.
        reader.email_change_token = None
        reader.email_change_pending = None
        reader.email_change_requested_at = None
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")

    # Account moderation (DEC-194, TASK-214): a deactivated reader must not
    # redeem a pending change — the operator disabled the account, so swapping
    # its email (or minting a fresh auto-login token) would contradict that.
    # Mirrors password reset, which refuses inactive readers. The stale pending
    # is cleared so a re-request (impossible for them, but consistent) would
    # start clean.
    if reader.is_active is False:
        reader.email_change_token = None
        reader.email_change_pending = None
        reader.email_change_requested_at = None
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")

    target = reader.email_change_pending
    # Case-insensitive occupied check (the login path matches emails the same
    # defensive way): current writers always store lowercase, but a legacy
    # mixed-case address must trip a clean 409 rather than a unique-index 500.
    occupied = (
        db.query(auth.ReaderAccount)
        .filter(func.lower(auth.ReaderAccount.email) == target, auth.ReaderAccount.id != reader.id)
        .first()
    )
    if occupied is not None:
        reader.email_change_token = None
        reader.email_change_pending = None
        reader.email_change_requested_at = None
        db.commit()
        raise HTTPException(status_code=409, detail="That email is already in use; please request a new change")

    # Atomic single-statement redeem (see docstring): both the swap and the
    # clear are conditional on the stored token still being the presented one,
    # so a concurrent double-click or a replaced pending token returns 400
    # (rowcount 0) instead of a second 200 / a lost newer pending.
    redeemed = (
        db.query(auth.ReaderAccount)
        .filter(
            auth.ReaderAccount.id == reader.id,
            auth.ReaderAccount.email_change_token == payload.token,
        )
        .update(
            {
                "email": target,
                "email_change_token": None,
                "email_change_pending": None,
                "email_change_requested_at": None,
                "token_version": (reader.token_version or 0) + 1,
                "last_login_at": now,
            },
            synchronize_session=False,
        )
    )
    if redeemed == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="Invalid or expired verification link")
    try:
        db.commit()
    except IntegrityError:
        # The target address got taken (concurrent register/change) after the
        # occupied check — surface the business 409 and clear the stale pending
        # so the reader's next request starts clean, never a 500.
        db.rollback()
        reader = db.query(auth.ReaderAccount).filter(auth.ReaderAccount.id == reader.id).first()
        if reader is not None:
            reader.email_change_token = None
            reader.email_change_pending = None
            reader.email_change_requested_at = None
            db.commit()
        raise HTTPException(
            status_code=409, detail="That email is already in use; please request a new change"
        ) from None
    db.refresh(reader)
    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(reader),
    }


@router.post("/password-reset/request", status_code=202)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def request_password_reset(
    request: Request,  # noqa: ARG001
    payload: ReaderPasswordResetRequest,
    db: Session = Depends(get_db),
):
    """Email a password-reset link, without revealing whether the address exists.

    Always returns the same 202 whether or not ``email`` maps to an account, so
    the endpoint is not an account-existence oracle (DEC-286, TASK-371 — the
    generic-response outcome DEC-060 wanted for register). The only non-202s are
    infrastructure 503s (SMTP unconfigured / send failed), which carry no
    account information either. A reset email is only sent to active accounts;
    a deactivated reader gets the same generic 202 with no mail, so a reset link
    can never be used to probe moderation state. Rate-limited like login.
    """
    normalized_email = payload.email.lower().strip()
    if not emailer.is_email_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email service is not configured on this server",
        )
    reader = (
        db.query(auth.ReaderAccount)
        .filter(
            auth.ReaderAccount.email == normalized_email,
            auth.ReaderAccount.is_active.is_(True),
        )
        .first()
    )
    # Unknown email is not an error: the same generic 202 is what matters. Only
    # compose/send mail when an active account exists.
    if reader is not None:
        token = auth.create_password_reset_token(reader.id, token_version=reader.token_version or 0)
        try:
            accepted = emailer.send_password_reset_email(reader.email, token)
        except Exception:
            # Connection-level SMTP failure → infrastructure 503 (no account info).
            logger.exception("password-reset email send raised")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not send the reset email, please try again later",
            )
        if not accepted:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Could not send the reset email, please try again later",
            )
    # Generic success — the same body for known and unknown addresses.
    return {"message": "If that email is registered, a reset link is on its way"}


@router.post("/password-reset/confirm", response_model=ReaderPasswordChangeResponse)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def confirm_password_reset(
    request: Request,  # noqa: ARG001
    payload: ReaderPasswordResetConfirm,
    db: Session = Depends(get_db),
):
    """Redeem a reset token: set a new password, revoke every session, and log in.

    ``get_reader_for_password_reset`` rejects expired/tampered/wrong-audience
    tokens and tokens older than the reader's current password epoch. On
    success the password is set and ``token_version`` is bumped (one bump — the
    password epoch the new token is issued under), which invalidates every
    previously issued reader JWT *and* this reset token (its ``ver`` no longer
    matches). The reader is auto-logged-in with a fresh token, mirroring
    register/password-change UX (DEC-286, TASK-371).
    """
    reader = auth.get_reader_for_password_reset(payload.token, db)
    if reader is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset link",
        )
    reader.password = auth.get_password_hash(payload.new_password)
    reader.token_version = (reader.token_version or 0) + 1
    db.commit()
    db.refresh(reader)
    reader.last_login_at = datetime.now(UTC)
    db.commit()

    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "reader": ReaderProfile.model_validate(reader),
    }


class ReaderAccountDelete(BaseModel):
    """Body for reader self-service account deletion (DEC-106, TASK-165)."""

    password: str


@router.delete("/me/account", status_code=204)
@limiter.limit(f"{RATE_LIMIT_AUTH}/minute")
def delete_my_account(
    request: Request,  # noqa: ARG001
    payload: ReaderAccountDelete,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Permanently delete the reader's own account.

    Requires the current password (timing-safe, same helper as login/change).
    On success the account is removed, their cloud bookmarks/subscriptions are
    deleted, and their past comments are anonymized (identity detached, comment
    kept public). A wrong password is a 401; the response is 204 and the caller
    is now logged out (the account no longer resolves). (DEC-106, TASK-165)
    """
    if not auth.verify_password(payload.password, current_reader.password):
        raise HTTPException(status_code=401, detail="Incorrect current password")
    # Grab the avatar URL before the row dies (crud commits the DELETE, after
    # which a lazy refresh of the account object would throw).
    avatar_url = current_reader.avatar_url
    try:
        deleted = crud.delete_reader_account(db, current_reader.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Account not found")
    # The account row is gone; its avatar file (a reader-private upload) goes
    # too — crud only reaps DB rows (DEC-299/TASK-378 was added after the last
    # deletion deep-dive, so the file would otherwise linger after delete).
    _delete_avatar_file(avatar_url)
    return None


@router.get("/me/push-subscriptions", response_model=ReaderPushSubscriptionListResponse)
def list_my_push_subscriptions(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The reader's push subscriptions bound to their account (device view).

    Lets a reader see which browsers/devices currently receive their
    notifications and revoke any they no longer control. Only rows bound to
    this reader (DEC-064 binds subscriptions at /api/push/subscribe)."""
    subs = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.reader_id == current_reader.id)
        .order_by(models.PushSubscription.created_at.desc())
        .all()
    )
    return ReaderPushSubscriptionListResponse(
        items=[
            ReaderPushSubscriptionItem(
                id=s.id,
                endpoint=s.endpoint,
                created_at=s.created_at,
                want_new_posts=s.want_new_posts,
                new_post_category_id=s.new_post_category_id,
            )
            for s in subs
        ],
        total=len(subs),
    )


@router.patch("/me/push-subscriptions/{subscription_id}", response_model=ReaderPushSubscriptionItem)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def update_my_push_subscription_prefs(
    request: Request,  # noqa: ARG001
    subscription_id: IdInt,
    payload: ReaderPushSubscriptionUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Update the new-post notification prefs on one of the reader's devices.

    Lets a reader follow a category (or all new posts) from their account
    settings, per browser/device. Scoped to the caller: another reader's or an
    unknown id is a 404 so subscription ids are not enumerable. An unknown
    category id is a 422 (the fan-out matches on it, so it must exist).
    (DEC-076, TASK-147)
    """
    sub = (
        db.query(models.PushSubscription)
        .filter(
            models.PushSubscription.id == subscription_id,
            models.PushSubscription.reader_id == current_reader.id,
        )
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="Push subscription not found")
    if payload.new_post_category_id is not None and crud.get_category(db, payload.new_post_category_id) is None:
        raise HTTPException(status_code=422, detail="Unknown new_post_category_id")
    sub.want_new_posts = payload.want_new_posts
    sub.new_post_category_id = payload.new_post_category_id
    db.commit()
    db.refresh(sub)
    return ReaderPushSubscriptionItem(
        id=sub.id,
        endpoint=sub.endpoint,
        created_at=sub.created_at,
        want_new_posts=sub.want_new_posts,
        new_post_category_id=sub.new_post_category_id,
    )


@router.delete("/me/push-subscriptions/{subscription_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def revoke_my_push_subscription(
    request: Request,  # noqa: ARG001
    subscription_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Revoke one of the reader's push subscriptions (204).

    Scoped to the caller: another reader's or an unknown id is a 404 so
    subscription ids are not enumerable. The browser keeps its local
    subscription; it simply stops receiving this account's notifications."""
    sub = (
        db.query(models.PushSubscription)
        .filter(
            models.PushSubscription.id == subscription_id,
            models.PushSubscription.reader_id == current_reader.id,
        )
        .first()
    )
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.delete(sub)
    db.commit()
    return None


# ---------------------------------------------------------------------------
# Cloud-synced bookmarks (DEC-059/TASK-132)
# ---------------------------------------------------------------------------


@router.get("/me/bookmarks", response_model=BookmarkListResponse)
def list_bookmarks(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    folder_id: IdInt | None = Query(None, description="filter to this folder"),
    done: bool | None = Query(None, description="filter to Done (true) or To-read (false)"),
    page: PageInt = 1,
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List the reader's bookmarked posts (publicly-visible only), paginated.

    Non-public posts (draft/scheduled/unpublished) are excluded — a bookmark
    list is a read path and must not leak post existence/visibility changes.
    Newest bookmark first (the natural "recently saved" ordering). Optional
    ``folder_id`` filters to that folder (DEC-120/TASK-172) and ``done`` to
    the To-read/Done queue state (round 361, DEC-395). Bounded paging
    (page/limit, max 100) keeps setup/merge calls from loading every row
    (ISS-142); clients that need the full set page through ``total_pages``.
    """
    rows, total = crud.list_reader_bookmarks(
        db, current_reader.id, folder_id=folder_id, done=done, page=page, limit=limit
    )
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    return BookmarkListResponse(
        items=[BookmarkItem.from_post(p, fid, fname, d) for p, fid, fname, d in rows],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.get("/me/post-subscriptions", response_model=SubscribedThreadListResponse)
def list_my_post_subscriptions(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    page: PageInt = 1,
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """The comment threads the reader follows (publicly-visible posts only), paginated.

    Same non-leak invariant as the bookmark list: a followed post that became
    a draft/scheduled no longer appears, while the follow row is kept (the
    reader unsubscribes from the post page). Newest follow first. Bounded
    paging like the bookmark list (ISS-142).
    """
    posts, total = crud.list_reader_comment_subscriptions(db, current_reader.id, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    return SubscribedThreadListResponse(
        items=[SubscribedThreadItem.from_post(p) for p in posts],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.put("/me/bookmarks/{post_id}", response_model=AddBookmarkResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def add_bookmark(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Bookmark a public post. Idempotent: 201 on first save, 200 on re-save
    (already_existed=True) so a merge/re-login client can re-put the same set
    without errors or duplicates.

    Drafts/scheduled/unknown posts are uniformly 404 — no draft-existence
    oracle (same guard as the public comment-create path).
    """
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    bookmark, created = crud.add_reader_bookmark(db, current_reader.id, post.id)
    response.status_code = 201 if created else 200
    return AddBookmarkResponse(post_id=bookmark.post_id, already_existed=not created)


@router.delete("/me/bookmarks", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def clear_bookmarks(
    request: Request,  # noqa: ARG001
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Delete every bookmark the reader has saved, cloud side included.

    The reader /bookmarks page offers "Clear all": the client clears its
    localStorage mirror AND this endpoint so a signed-in reader's clear
    actually sticks across devices (previously only local storage was wiped
    and the next cloud merge resurrected the list). Idempotent 204 even when
    there was nothing to clear."""

    crud.clear_reader_bookmarks(db, current_reader.id)
    return None


@router.delete("/me/bookmarks/{post_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def remove_bookmark(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Remove a bookmark. Idempotent: deleting a non-existent bookmark is a
    204 no-op (merge-friendly)."""
    crud.remove_reader_bookmark(db, current_reader.id, post_id)
    return None


# ---------------------------------------------------------------------------
# Cloud-synced likes (round 359)
# ---------------------------------------------------------------------------


@router.get("/me/likes", response_model=schemas.PostListResponse)
def list_my_likes(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    q: str | None = Query(None, max_length=200, description="title/excerpt keyword filter"),
    page: PageInt = 1,
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """A signed-in reader's liked posts (publicly-visible only), paginated.

    The "posts I liked" surface the local client marker could never show:
    bookmarks list what a reader saved to read, history lists what they read,
    and now likes list what they appreciated. Same non-leak invariant as the
    bookmark list — a liked post that became a draft/scheduled no longer
    appears here (the like row is kept). Newest like first. Bounded paging.
    ``q`` (optional) filters to liked posts matching title/excerpt
    (escape-aware — DEC-413/TASK-432, recall-search like history DEC-148).
    """
    posts, total = crud.list_reader_post_likes(db, current_reader.id, page=page, limit=limit, q=q)
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


@router.post("/me/likes/{post_id}", response_model=AddBookmarkResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def like_post(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Like a public post as a signed-in reader. Idempotent like a bookmark:
    201 on first like (and the public counter is bumped exactly once), 200 on
    re-like with already_existed=True (no double-count) — so a merge/re-login
    client can re-send the whole local marker set without inflating counts.

    Drafts/scheduled/unknown posts are uniformly 404 (no draft-existence
    oracle, same guard as bookmark/comment-create paths).
    """
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    like, created = crud.add_reader_post_like(db, current_reader.id, post.id)
    if created:
        # The durable per-reader row is the cross-device truth; the public
        # counter is the aggregate badge. Bump it exactly once per NEW like.
        crud.increment_likes(db, post.id)
    response.status_code = 201 if created else 200
    return AddBookmarkResponse(post_id=like.post_id, already_existed=not created)


@router.delete("/me/likes/{post_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def unlike_post(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Remove the reader's like of a post. Idempotent 204 like bookmark remove,
    but only decrements the public counter when a like was actually removed
    (an unlike of a never-liked post doesn't tear the count below its true
    aggregate)."""
    removed = crud.remove_reader_post_like(db, current_reader.id, post_id)
    if removed:
        crud.decrement_likes(db, post_id)
    return None


# Bookmark folders / collections (DEC-120/TASK-172)
# ---------------------------------------------------------------------------


@router.get("/me/bookmarks/folders", response_model=BookmarkFolderListResponse)
def list_bookmark_folders(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """List the reader's bookmark folders with their saved-post counts."""
    folders = crud.list_reader_bookmark_folders(db, current_reader.id)
    return BookmarkFolderListResponse(
        items=[BookmarkFolderItem(id=f.id, name=f.name, count=c) for f, c in folders],
        total=len(folders),
    )


@router.post("/me/bookmarks/folders", response_model=BookmarkFolderResponse, status_code=201)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def create_bookmark_folder(
    request: Request,  # noqa: ARG001
    body: FolderCreate,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Create a bookmark folder. Idempotent: a same-named folder already
    existing returns 200 with created=False semantics (no error)."""
    folder, created = crud.create_bookmark_folder(db, current_reader.id, body.name)
    response.status_code = 201 if created else 200
    return BookmarkFolderResponse(id=folder.id, name=folder.name)


@router.patch("/me/bookmarks/folders/{folder_id}", response_model=BookmarkFolderResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def rename_bookmark_folder(
    request: Request,  # noqa: ARG001
    folder_id: IdInt,
    body: FolderRename,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Rename a folder. 404 if it doesn't belong to the reader; 409 if the new
    name collides with another of the reader's folders."""
    folder = crud.rename_bookmark_folder(db, current_reader.id, folder_id, body.name)
    if not folder:
        # Distinguish not-found vs duplicate-name.
        existing = crud.get_bookmark_folder(db, current_reader.id, folder_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Folder not found")
        raise HTTPException(status_code=409, detail="Folder name already exists")
    return BookmarkFolderResponse(id=folder.id, name=folder.name)


@router.delete("/me/bookmarks/folders/{folder_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_bookmark_folder(
    request: Request,  # noqa: ARG001
    folder_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Delete a folder (its bookmarks become uncategorized). Idempotent 204."""
    crud.delete_bookmark_folder(db, current_reader.id, folder_id)
    return None


@router.patch("/me/bookmarks/{post_id}/folder", response_model=AssignFolderResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def assign_bookmark_folder(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    body: AssignFolder,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """File a bookmarked post into a folder (or clear with folder_id=None).

    404 if the post isn't bookmarked by the reader or the folder isn't theirs.
    """
    bookmark = crud.set_bookmark_folder(db, current_reader.id, post_id, body.folder_id)
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark or folder not found")
    return AssignFolderResponse(post_id=bookmark.post_id, folder_id=bookmark.folder_id)


@router.patch("/me/bookmarks/{post_id}/done", response_model=BookmarkDoneResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def set_bookmark_done(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    body: BookmarkDone,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Move a saved post between To-read and Done (round 361, DEC-395).

    The /bookmarks page marks a saved post Done when it's read (pruning the
    To-read queue) and back To-read otherwise. Idempotent; 404 if the post
    isn't bookmarked by this reader.
    """
    bookmark = crud.set_reader_bookmark_done(db, current_reader.id, post_id, body.done)
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    return BookmarkDoneResponse(post_id=bookmark.post_id, done=bookmark.done)


@router.get("/me/series/{slug}/progress", response_model=SeriesProgressResponse)
def series_reading_progress(
    slug: str,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """A reader's reading progress through a series, from their history.

    Reads are posts present in the reader's reading_history among the series'
    ordered publicly-visible posts. 404 if the series slug is unknown.
    """
    series = crud.get_series_by_slug(db, slug)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    prog = crud.reader_series_progress(db, current_reader.id, series)
    return SeriesProgressResponse(
        series_slug=series.slug,
        series_title=series.title,
        **prog,
    )


@router.get("/me/export", response_model=DataExportResponse)
@limiter.limit(f"{RATE_LIMIT_EXPORT}/minute")
def export_my_data(
    request: Request,  # noqa: ARG001
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Return the caller's portable data bundle (account, bookmarks, comments,
    history). Auth-scoped — only the signed-in reader's own data (DEC-126).

    Rate-limited like the other export/backup surfaces (RATE_LIMIT_EXPORT):
    the bundle assembles every comment + history row, so an unthrottled reader
    token could otherwise serialize large payloads on demand (security review).
    """
    return DataExportResponse(**crud.export_reader_data(db, current_reader.id))


@router.get("/me/recommendations", response_model=list[schemas.PostList])
def my_recommendations(
    limit: int = Query(6, ge=1, le=20),
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Personalized post recommendations for the signed-in reader (DEC-128)."""
    recommended = crud.recommend_posts(db, current_reader.id, limit=limit)
    return [schemas.PostList.model_validate(p) for p in recommended]


@router.get("/me/follows-feed", response_model=schemas.PostListResponse)
def my_follows_feed(
    page: PageInt = 1,
    limit: int = Query(12, ge=1, le=50),
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Recent public posts from the reader's followed categories + series + tags.

    Paginated (DEC-142/TASK-183, pagination DEC-292/TASK-375): the home section
    uses page 1, the dedicated /follows page pages through all of them.
    """
    # Fire the scheduled-post publish-time fan-out (DEC-344/TASK-398): this is
    # the follower's OWN aggregation surface — the most likely place they
    # notice a crossed scheduled post — so it must trigger the same exactly-
    # once announce as the other public surfaces (round-331 sweep). Cheap
    # indexed no-op when nothing crossed; the durable stamp prevents duplicates.
    crud.maybe_notify_due_scheduled_posts(db)
    posts, total = crud.follows_feed_posts(db, current_reader.id, limit=limit, offset=(page - 1) * limit)
    total_pages = (total + limit - 1) // limit
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


@router.get("/me/series-follows", response_model=FollowedSeriesListResponse)
def list_series_follows(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The series the reader follows, with per-follow notification state."""
    follows = crud.list_reader_series_follows(db, current_reader.id)
    return FollowedSeriesListResponse(
        items=[
            FollowedSeriesItem(
                id=f.series_id,
                title=f.series.title if f.series else str(f.series_id),
                slug=f.series.slug if f.series else "",
                description=f.series.description if f.series else None,
                notify=f.notify,
            )
            for f in follows
        ],
        total=len(follows),
    )


@router.put("/me/series/{series_id}/follow", response_model=SeriesFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def follow_series(
    request: Request,  # noqa: ARG001
    series_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Follow a series for new-part push (idempotent: 201 on first, 200 on re-follow)."""
    series = db.get(models.Series, series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    follow, created = crud.add_series_follow(db, current_reader.id, series_id)
    response.status_code = 201 if created else 200
    return SeriesFollowResponse(series_id=series.id, series_slug=series.slug, following=True, notify=follow.notify)


class SeriesFollowNotifyUpdate(BaseModel):
    """Body for toggling per-series new-part push notifications (TASK-181)."""

    notify: bool


@router.patch("/me/series/{series_id}/follow", response_model=SeriesFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def set_series_follow_notify(
    request: Request,  # noqa: ARG001
    series_id: IdInt,
    payload: SeriesFollowNotifyUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Toggle new-part notifications for a followed series. 404 if not following."""
    series = db.get(models.Series, series_id)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    follow = crud.set_series_follow_notify(db, current_reader.id, series_id, payload.notify)
    if not follow:
        raise HTTPException(status_code=404, detail="Not following this series")
    return SeriesFollowResponse(series_id=series.id, series_slug=series.slug, following=True, notify=follow.notify)


@router.delete("/me/series/{series_id}/follow", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def unfollow_series(
    request: Request,  # noqa: ARG001
    series_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Unfollow a series. Idempotent 204."""
    crud.remove_series_follow(db, current_reader.id, series_id)
    return None


@router.get("/me/category-follows", response_model=FollowedCategoryListResponse)
def list_category_follows(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The categories the reader follows, with per-follow notification state."""
    follows = crud.list_reader_category_follows(db, current_reader.id)
    return FollowedCategoryListResponse(
        items=[
            FollowedCategoryItem(
                id=f.category_id,
                name=f.category.name if f.category else str(f.category_id),
                notify=f.notify,
            )
            for f in follows
        ],
        total=len(follows),
    )


@router.put("/me/categories/{category_id}/follow", response_model=CategoryFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def follow_category(
    request: Request,  # noqa: ARG001
    category_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Follow a category for new-post push (idempotent: 201 on first, 200 on re-follow)."""
    category = db.get(models.Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    follow, created = crud.add_category_follow(db, current_reader.id, category_id)
    response.status_code = 201 if created else 200
    return CategoryFollowResponse(
        category_id=category.id,
        category_name=category.name,
        following=True,
        notify=follow.notify,
    )


@router.patch("/me/categories/{category_id}/follow", response_model=CategoryFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def set_category_follow_notify(
    request: Request,  # noqa: ARG001
    category_id: IdInt,
    payload: CategoryFollowNotifyUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Toggle new-post notifications for a followed category. 404 if not following."""
    category = db.get(models.Category, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    follow = crud.set_category_follow_notify(db, current_reader.id, category_id, payload.notify)
    if not follow:
        raise HTTPException(status_code=404, detail="Not following this category")
    return CategoryFollowResponse(
        category_id=category.id,
        category_name=category.name,
        following=True,
        notify=follow.notify,
    )


@router.delete("/me/categories/{category_id}/follow", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def unfollow_category(
    request: Request,  # noqa: ARG001
    category_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Unfollow a category. Idempotent 204."""
    crud.remove_category_follow(db, current_reader.id, category_id)
    return None


@router.get("/me/tag-follows", response_model=FollowedTagListResponse)
def list_tag_follows(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The tags the reader follows, with per-follow notification state."""
    follows = crud.list_reader_tag_follows(db, current_reader.id)
    return FollowedTagListResponse(
        items=[
            FollowedTagItem(
                id=f.tag_id,
                name=f.tag.name if f.tag else str(f.tag_id),
                notify=f.notify,
            )
            for f in follows
        ],
        total=len(follows),
    )


@router.put("/me/tags/{tag_id}/follow", response_model=TagFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def follow_tag(
    request: Request,  # noqa: ARG001
    tag_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Follow a tag for new-post push (idempotent: 201 on first, 200 on re-follow)."""
    tag = db.get(models.Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    follow, created = crud.add_tag_follow(db, current_reader.id, tag_id)
    response.status_code = 201 if created else 200
    return TagFollowResponse(
        tag_id=tag.id,
        tag_name=tag.name,
        following=True,
        notify=follow.notify,
    )


@router.patch("/me/tags/{tag_id}/follow", response_model=TagFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def set_tag_follow_notify(
    request: Request,  # noqa: ARG001
    tag_id: IdInt,
    payload: TagFollowNotifyUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Toggle new-post notifications for a followed tag. 404 if not following."""
    tag = db.get(models.Tag, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    follow = crud.set_tag_follow_notify(db, current_reader.id, tag_id, payload.notify)
    if not follow:
        raise HTTPException(status_code=404, detail="Not following this tag")
    return TagFollowResponse(
        tag_id=tag.id,
        tag_name=tag.name,
        following=True,
        notify=follow.notify,
    )


@router.delete("/me/tags/{tag_id}/follow", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def unfollow_tag(
    request: Request,  # noqa: ARG001
    tag_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Unfollow a tag. Idempotent 204."""
    crud.remove_tag_follow(db, current_reader.id, tag_id)
    return None


# Author follows (round 353): subscribe to a writer's new posts, the
# person-shaped cousin of the topic-shaped category/series/tag follows.
# ---------------------------------------------------------------------------
def _get_followable_author(db: Session, author_id: int) -> auth.User:
    """The pen-named admin a reader may follow; 404 otherwise (no-oracle:
    a username-only admin has no public identity to follow, so probing ids
    yields the same 404 as an unknown one)."""
    author = db.get(auth.User, author_id)
    if author is None or not author.display_name:
        raise HTTPException(status_code=404, detail="Author not found")
    return author


@router.get("/me/author-follows", response_model=FollowedAuthorListResponse)
def list_author_follows(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The writers the reader follows, with per-follow notification state."""
    follows = crud.list_reader_author_follows(db, current_reader.id)
    items = []
    for f in follows:
        author = f.author
        if author is None or not author.display_name:
            continue  # pen-named only; a username-only admin is invisible
        items.append(
            FollowedAuthorItem(
                author_id=f.author_id,
                display_name=author.display_name,
                notify=f.notify,
            )
        )
    return FollowedAuthorListResponse(items=items, total=len(items))


@router.put("/me/authors/{author_id}/follow", response_model=AuthorFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def follow_author(
    request: Request,  # noqa: ARG001
    author_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Follow a writer for new-post push (idempotent: 201 on first, 200 on re-follow)."""
    author = _get_followable_author(db, author_id)
    follow, created = crud.add_author_follow(db, current_reader.id, author_id)
    response.status_code = 201 if created else 200
    return AuthorFollowResponse(
        author_id=int(author.id),
        display_name=author.display_name or "",
        following=True,
        notify=follow.notify,
    )


@router.patch("/me/authors/{author_id}/follow", response_model=AuthorFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def set_author_follow_notify(
    request: Request,  # noqa: ARG001
    author_id: IdInt,
    payload: AuthorFollowNotifyUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Toggle new-post notifications for a followed author. 404 if not following."""
    author = _get_followable_author(db, author_id)
    follow = crud.set_author_follow_notify(db, current_reader.id, author_id, payload.notify)
    if not follow:
        raise HTTPException(status_code=404, detail="Not following this author")
    return AuthorFollowResponse(
        author_id=author_id,
        display_name=author.display_name or "",
        following=True,
        notify=follow.notify,
    )


@router.delete("/me/authors/{author_id}/follow", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def unfollow_author(
    request: Request,  # noqa: ARG001
    author_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Unfollow a writer. Idempotent 204."""
    crud.remove_author_follow(db, current_reader.id, author_id)
    return None


# Reader → reader follow (round 365, DEC-403): the person-shaped axis of the
# follow wheel — a reader can subscribe to another commenter's approved
# comments. Mirrors the author-follow endpoints (idempotent, self-follow and
# unknown/inactive targets rejected, never the email).
def _get_followable_reader(db: Session, reader_id: int) -> auth.ReaderAccount | None:
    """An active reader that can be followed (not-deleted, exists), else None."""
    return db.query(auth.ReaderAccount).filter(auth.ReaderAccount.id == reader_id).first()


@router.get("/me/follows/readers", response_model=FollowedReaderListResponse)
def list_reader_follows(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The readers the reader follows, newest first, for /account management."""
    rows = crud.list_reader_follows(db, current_reader.id)
    items = []
    for f in rows:
        followed = f.followed
        if followed is None or followed.is_active is False:
            # A deactivated-reader follow is like a username-only author: it has
            # no usable public identity, so it is dropped from the management
            # list rather than surfacing a dead row.
            continue
        items.append(
            FollowedReaderItem(
                reader_id=f.followed_id,
                display_name=followed.display_name,
                avatar_url=followed.avatar_url,
                notify=f.notify,
            )
        )
    return FollowedReaderListResponse(items=items, total=len(items))


@router.put("/me/follows/readers/{reader_id}", response_model=ReaderFollowResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def follow_reader(
    request: Request,  # noqa: ARG001
    reader_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Follow another reader for comment fan-out. Idempotent: 201/200.

    Self-follow is rejected (a reader cannot subscribe to themself) and an
    unknown/deactivated target is a uniform 404 — no followability oracle.
    """
    if reader_id == current_reader.id:
        raise HTTPException(status_code=400, detail="You cannot follow yourself")
    target = _get_followable_reader(db, reader_id)
    if target is None or target.is_active is False:
        raise HTTPException(status_code=404, detail="Reader not found")
    follow, created = crud.add_reader_follow(db, current_reader.id, reader_id)
    response.status_code = 201 if created else 200
    return ReaderFollowResponse(
        reader_id=reader_id,
        display_name=target.display_name,
        following=True,
        notify=follow.notify,
    )


@router.delete("/me/follows/readers/{reader_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def unfollow_reader(
    request: Request,  # noqa: ARG001
    reader_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Unfollow a reader. Idempotent 204."""
    crud.remove_reader_follow(db, current_reader.id, reader_id)
    return None


# Reader blocks (DEC-425, TASK-437)
# ---------------------------------------------------------------------------


@router.get("/me/blocks", response_model=BlockedReaderListResponse)
def list_reader_blocks(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The readers this reader has blocked, newest first, for management.

    Public identity only (display name + avatar, no email), like the follow
    list — enough to recognize who was blocked. A deactivated account has no
    usable public identity, so it is dropped rather than showing a dead row
    (same rule as list_reader_follows).
    """
    rows = crud.list_reader_blocks(db, current_reader.id)
    items = []
    for b in rows:
        blocked = db.get(auth.ReaderAccount, b.blocked_id)
        if blocked is None or blocked.is_active is False:
            continue
        items.append(
            BlockedReaderItem(
                reader_id=b.blocked_id,
                display_name=blocked.display_name,
                avatar_url=blocked.avatar_url,
                blocked_at=b.created_at,
            )
        )
    return BlockedReaderListResponse(items=items, total=len(items))


@router.put("/me/blocks/{reader_id}", response_model=BlockedReaderItem)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def block_reader(
    request: Request,  # noqa: ARG001
    reader_id: IdInt,
    response: Response,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Block another reader's personal fan-out. Idempotent: 201/200.

    Self-block is rejected (a reader cannot block themself) and an
    unknown/deactivated target is a uniform 404 — no blockability oracle.
    The blocked reader is never notified; the block silently suppresses their
    mentions / replies / thread-comments / follow-activity to this reader.
    """
    if reader_id == current_reader.id:
        raise HTTPException(status_code=400, detail="You cannot block yourself")
    target = _get_followable_reader(db, reader_id)
    if target is None or target.is_active is False:
        raise HTTPException(status_code=404, detail="Reader not found")
    block, created = crud.add_reader_block(db, current_reader.id, reader_id)
    response.status_code = 201 if created else 200
    return BlockedReaderItem(
        reader_id=reader_id,
        display_name=target.display_name,
        avatar_url=target.avatar_url,
        blocked_at=block.created_at,
    )


@router.delete("/me/blocks/{reader_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def unblock_reader(
    request: Request,  # noqa: ARG001
    reader_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Unblock a reader. Idempotent 204; restores their notifications."""
    crud.remove_reader_block(db, current_reader.id, reader_id)
    return None


# Server-backed reading history (DEC-116/TASK-170)
# ---------------------------------------------------------------------------


@router.get("/me/history", response_model=ReadingHistoryListResponse)
def list_reading_history(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    # q is bound to the same length as the public search term (search.py
    # MAX_QUERY_LENGTH) — an unbounded string would otherwise reach the ILIKE
    # bind on this unthrottled endpoint (round-296 deep-dive).
    q: Annotated[
        NonNulStr | None, Query(max_length=200, description="filter history to posts matching this term")
    ] = None,
    db: Session = Depends(get_db),
):
    """The reader's viewed posts, newest-first, publicly-visible only.

    Paginated so the history list stays bounded. ``q`` filters to posts whose
    title/excerpt match (recall search, DEC-148/TASK-186). Same non-leak
    invariant as bookmarks/subs: a viewed post that went dark stops appearing
    (row kept).
    """
    rows, total = crud.list_reader_history(db, current_reader.id, page=page, limit=limit, q=q)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    return ReadingHistoryListResponse(
        items=[ReadingHistoryItem.from_post(p, viewed_at) for p, viewed_at in rows],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.get("/me/history/in-progress", response_model=ReadingHistoryListResponse)
def list_in_progress(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    limit: int = Query(6, ge=1, le=20),
    db: Session = Depends(get_db),
):
    """The reader's posts with a saved resume position, newest-first (DEC-348,
    TASK-400) — the cross-device "Continue reading" trail for the home page.

    Declared BEFORE ``/me/history/{post_id}`` so the literal path is not
    captured by the parameterized route (same ordering rule as the ``import``
    below). Same auth + non-leak invariants as the history list: guests/admin
    tokens 401, a post that went dark stops appearing (row kept).
    """
    rows, total = crud.list_reader_in_progress(db, current_reader.id, limit=limit)
    return ReadingHistoryListResponse(
        items=[ReadingHistoryItem.from_post(p, viewed_at) for p, viewed_at in rows],
        total=total,
        page=1,
        limit=limit,
        total_pages=(total + limit - 1) // limit if limit > 0 else 0,
    )


@router.get("/me/history/stats", response_model=ReadingStatsResponse)
def reading_history_stats(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    tz: Annotated[
        NonNulStr | None,
        Query(
            max_length=64,
            description="IANA timezone id (e.g. Asia/Shanghai) so the streak and "
            "heatmap align to the reader's local calendar day; omitted → UTC (DEC-316)",
        ),
    ] = None,
    db: Session = Depends(get_db),
):
    """A reader's reading summary (posts read, minutes, latest activity).

    The streak and 52-week activity heatmap are bucketed by the reader's local
    calendar day when ``tz`` (an IANA id, e.g. ``Asia/Shanghai``) is sent —
    before DEC-316 they aggregated in UTC, so a non-UTC reader's streak and
    heatmap disagreed with their own calendar. Omitted → the legacy UTC view.
    An unknown timezone is a 422, never a silent UTC fallback (a typo must not
    quietly re-break the alignment this endpoint exists to provide).
    """
    tz_info = None
    if tz:
        try:
            tz_info = ZoneInfo(tz)
        except ZoneInfoNotFoundError as exc:
            raise HTTPException(status_code=422, detail="Unknown timezone") from exc
    stats = crud.reader_history_stats(db, current_reader.id, recent_limit=6, tz=tz_info)
    return ReadingStatsResponse(
        total_posts=stats["total_posts"],
        total_reading_minutes=stats["total_reading_minutes"],
        last_viewed_at=stats["last_viewed_at"],
        recent=[ReadingHistoryItem.from_post(p, viewed_at) for p, viewed_at in stats["recent"]],
        current_streak=stats["current_streak"],
        longest_streak=stats["longest_streak"],
        activity=[DayActivity(**a) for a in stats["activity"]],
    )


@router.get("/me/history/insights", response_model=ReadingInsightsResponse)
def reading_history_insights(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """A reader's reading insights: what and how much they've read (DEC-417).

    Complements /me/history/stats (the calendar shape — streak/heatmap) with
    the content shape: distinct publicly-visible posts read all-time and in
    the trailing 30 days, plus the most-read categories. Same
    public-visibility invariant as every history read path — un-published and
    scheduled posts neither leak nor count.
    """
    return ReadingInsightsResponse(**crud.reader_history_insights(db, current_reader.id))


class HistoryImportItem(BaseModel):
    """One device-local read to merge into the server history (TASK-303).

    ``slug`` identifies the post (the localStorage trail stores slugs, not ids);
    ``viewed_at`` is the guest's original read instant as naive UTC and is
    preserved when newer than any server row. Timestamp-less legacy rows send
    null. Declared BEFORE ``/me/history/{post_id}`` so the literal ``import``
    segment never gets captured as an integer post id.
    """

    slug: Annotated[NonNulStr, Field(min_length=1, max_length=150, description="public post slug")]
    viewed_at: datetime | None = None

    @field_validator("viewed_at", mode="after")
    @classmethod
    def _coerce_naive_utc(cls, value: datetime | None) -> datetime | None:
        # Same naive-UTC coercion every schema timestamp uses (DEC-213): a
        # zone-marked ISO from a device is stored as the same instant the
        # author read, never a local-wall-clock shift, so downstream compares
        # against stored naive-UTC rows cannot raise.
        return schemas._normalize_naive_utc(value)


class HistoryImportRequest(BaseModel):
    """Device-local trail to merge (TASK-303). Capped so a misbehaving client
    cannot flood the reader's history in a single request."""

    items: list[HistoryImportItem] = Field(min_length=1, max_length=1000)


class HistoryImportResponse(BaseModel):
    """Counts of the records that merged vs. were skipped.

    ``imported`` counts every record whose post resolved and is now part of the
    reader's server history (added, or already present with the newer read
    instant kept — idempotent). ``skipped`` counts records whose slug is
    unknown or whose post is not publicly visible; those stay on the device and
    can be retried as-is.
    """

    imported: int = 0
    skipped: int = 0


@router.post("/me/history/import", response_model=HistoryImportResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def import_reading_history(
    request: Request,  # noqa: ARG001
    body: HistoryImportRequest,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Merge the device-local reading trail into this reader's server history.

    Guests record reads to the localStorage trail (DEC-104/TASK-169); after
    sign-in the /history page reads the server trail and those device records
    silently disappear (RIL ISS-386, TASK-303). This idempotent, merge-by-slug
    bulk upsert preserves each record's original read time and only ever
    imports publicly visible posts (drafts/scheduled never leak — the same
    invariant as every other history read path).
    """
    imported, skipped = crud.import_reader_history(
        db,
        current_reader.id,
        [(item.slug, item.viewed_at) for item in body.items],
    )
    return HistoryImportResponse(imported=imported, skipped=skipped)


@router.get("/me/history/{post_id}", response_model=ReadingPositionResponse)
def reading_position(
    post_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """A reader's saved resume position for a public post (DEC-167/TASK-200).

    Returns the last scroll offset the reader saved for this post (or null when
    they never viewed it) so the post page can drop them back where they left
    off. Same public-post guard as the record path — a post that went dark is
    uniformly 404 and cannot be positioned (no draft oracle). The position is
    auth-scoped to the reader; it never appears in the public post payload.
    """
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    row = crud.get_reading_history(db, current_reader.id, post.id)
    return ReadingPositionResponse(
        post_id=post_id,
        scroll_position=row.scroll_position if row else None,
        scroll_fraction=row.scroll_fraction if row else None,
    )


@router.post("/me/history/{post_id}", response_model=RecordHistoryResponse)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def record_reading_view(
    request: Request,  # noqa: ARG001
    post_id: IdInt,
    body: RecordHistoryRequest | None = None,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Record a view on a public post (idempotent upsert).

    ``body`` is optional: omit it (or send ``scroll_position: null``) for a
    plain view that refreshes ``viewed_at`` without touching the saved resume
    position; send an explicit ``scroll_position`` to update it (DEC-167).
    ``scroll_fraction`` (DEC-346/TASK-399) updates the cross-viewport resume
    fraction the same way. Drafts/scheduled/unknown posts are uniformly 404 —
    no draft-existence oracle (same guard as the bookmark/comment paths).
    """
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    scroll_position = body.scroll_position if body is not None else None
    scroll_fraction = body.scroll_fraction if body is not None else None
    row, created = crud.record_reading_history(
        db,
        current_reader.id,
        post.id,
        scroll_position,
        scroll_fraction=scroll_fraction,
    )
    return RecordHistoryResponse(post_id=row.post_id, already_existed=not created)


@router.delete("/me/history", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def clear_reading_history(
    request: Request,  # noqa: ARG001
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Clear the reader's entire reading history. Idempotent (no-op if empty)."""
    crud.clear_reader_history(db, current_reader.id)
    return None


class ReaderCommentItem(schemas.CommentPublic):
    """A reader's own comment, its moderation status, plus the post it was left
    on (for navigation). `status` is derived: approved / rejected (reviewed and
    declined) / pending (awaiting review). (DEC-066, TASK-139)"""

    status: Literal["pending", "approved", "rejected"]
    post: schemas.CommentPostBrief | None = None


class ReaderCommentListResponse(BaseModel):
    items: list[ReaderCommentItem]
    total: int
    # Pagination metadata (DEC-102, TASK-163).
    page: int = 1
    limit: int = 20
    total_pages: int = 1


def _comment_status(c: models.Comment) -> Literal["pending", "approved", "rejected"]:
    if c.is_approved:
        return "approved"
    if c.reviewed_at is not None:
        return "rejected"
    return "pending"


# Statuses accepted by GET /api/reader/me/comments (DEC-102, TASK-163).
VALID_READER_COMMENT_STATUSES = ("all", "pending", "approved", "rejected")


@router.get("/me/comments", response_model=ReaderCommentListResponse)
def list_my_comments(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    status: str = Query("all", description="all | pending | approved | rejected"),
    q: str | None = Query(None, max_length=200, description="content keyword filter"),
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """The reader's own comment history with a status filter + pagination.

    A moderated blog hides pending/rejected comments from everyone but their
    author; this endpoint shows the caller's own comments with a derived
    status (pending / approved / rejected) plus the post they were left on so
    the frontend can link back. Anonymous readers have no history. ``status``
    is whitelisted and unknown values are rejected with 422 (DEC-102/TASK-163);
    ``q`` (optional) filters to comments whose content matches the term
    (escape-aware — DEC-411/TASK-431, same pattern as history recall-search).
    """
    if status not in VALID_READER_COMMENT_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {list(VALID_READER_COMMENT_STATUSES)}")
    comments, total = crud.get_reader_comments(db, current_reader.id, status=status, page=page, limit=limit, q=q)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    # Batch-load the posts once in a single query instead of db.get per comment
    # (many comments share a post; ISS-140) — one in_() query, not up to 100.
    post_ids = {c.post_id for c in comments}
    posts_by_id = {}
    if post_ids:
        rows = db.query(models.Post).filter(models.Post.id.in_(post_ids)).all()
        posts_by_id = {p.id: p for p in rows}
    items = []
    for c in comments:
        base = schemas.CommentPublic.model_validate(c).model_dump()
        post = posts_by_id.get(c.post_id)
        items.append(
            ReaderCommentItem(
                **base,
                status=_comment_status(c),
                post=(
                    schemas.CommentPostBrief(
                        id=post.id,
                        title=post.title,
                        slug=post.slug,
                    )
                    if post
                    else None
                ),
            )
        )
    return ReaderCommentListResponse(items=items, total=total, page=page, limit=limit, total_pages=total_pages)


@router.delete("/me/comments/{comment_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_my_comment(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Delete one of the reader's own comments (any status).

    Scoped to the caller: another reader's comment (or a missing id) is a 404,
    indistinguishable from a non-existent resource so comment ids are not
    enumerable. Admin delete (DELETE /api/comments/{id}) is unchanged. When the
    comment has replies they are reparented (crud.delete_reader_comment) so the
    thread stays coherent (DEC-096, TASK-160).
    """
    try:
        deleted = crud.delete_reader_comment(db, comment_id, current_reader.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found")
    return None


class ReaderCommentEdit(BaseModel):
    """Edit body for a reader's own comment (DEC-096, TASK-160)."""

    # Mirror CommentBase's gate (min_length=1 after stripping) so a
    # whitespace-only edit cannot blank a comment body — the create path has
    # rejected it since round 276; the edit path must agree (round-297
    # deep-dive).
    content: Annotated[NonNulStr, Field(min_length=1, max_length=5000)]

    @field_validator("content", mode="before")
    @classmethod
    def strip_content(cls, value: object) -> object:
        return schemas._strip_blank(value) if isinstance(value, str) else value


@router.patch("/me/comments/{comment_id}", response_model=schemas.CommentPublic)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def edit_my_comment(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    edit: ReaderCommentEdit,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Edit one of the reader's own comments (any status).

    Ownership-scoped exactly like delete: another reader's comment (or a
    missing id) is a 404 so comment ids are not enumerable. Only ``content``
    may change (post_id/parent_id/identity are preserved); the body is stored
    raw and re-rendered through the sanitized markdown pipeline, and
    ``edited_at`` is stamped. (DEC-096, TASK-160)

    Moderation re-entry (security review): the edit resets approval because it
    replaces public content; the second return value reports whether the
    comment was public before the edit. Re-apply the same verified-reader trust
    tier as comment create (DEC-098/100) — with auto-approve enabled an edited
    comment republishes immediately (consistent with how that tier treats new
    comments), otherwise it waits for a moderator exactly like a fresh comment.
    Approval notifications fire only when the edit genuinely brings the comment
    onto the public surface for the first time: a comment that was already
    approved never left it, so its subscribers were notified on the original
    publication and a mere edit must not re-fan out reply + thread
    notifications (RIL ISS-404).
    """
    updated, was_public = crud.update_reader_comment(db, comment_id, current_reader.id, edit.content)
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
    if updated.reader_id is not None and crud.boolean_setting(
        db, "auto_approve_reader_comments", AUTO_APPROVE_READER_COMMENTS
    ):
        approved = crud.approve_comment(db, updated.id, approved=True)
        if approved is not None:
            if not was_public:
                _notify_comment_approved(db, approved)
            return approved
    return updated


# Reader notification inbox (DEC-160/TASK-192)
# ---------------------------------------------------------------------------


class NotificationItem(BaseModel):
    """One durable reader notification (inbox). ``kind`` tags the source so the
    UI can render an icon/filter; ``read`` derives from read_at. ``url`` deep-links
    to the source post/comment. (DEC-160, TASK-192)"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    body: str | None = None
    url: str | None = None
    read: bool = False
    created_at: datetime | None = None


class NotificationListResponse(BaseModel):
    items: list[NotificationItem]
    total: int
    unread: int
    page: int = 1
    limit: int = 20
    total_pages: int = 1


@router.get("/me/notifications", response_model=NotificationListResponse)
def list_my_notifications(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    unread: bool = Query(False, description="filter to unread notifications only"),
    db: Session = Depends(get_db),
):
    """The signed-in reader's durable notification inbox, newest first.

    Unlike the fire-and-forget browser push, these rows are persisted at the
    same dispatch points (new post in a followed series/category, reply to the
    reader's comment, new comment on a followed thread) so a reader can review
    activity they missed. ``unread`` filters to not-yet-read rows; ``unread``
    in the response is the total unread count for the badge regardless of the
    filter. Auth-scoped; the global middleware defaults these to no-store.
    (DEC-160, TASK-192)
    """
    items, total = crud.list_reader_notifications(db, current_reader.id, page=page, limit=limit, unread_only=unread)
    unread_count = crud.unread_notification_count(db, current_reader.id)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    return NotificationListResponse(
        items=[
            NotificationItem(
                id=n.id,
                kind=n.kind,
                title=n.title,
                body=n.body,
                url=n.url,
                read=n.read_at is not None,
                created_at=n.created_at,
            )
            for n in items
        ],
        total=total,
        unread=unread_count,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.post("/me/notifications/{notification_id}/read", response_model=NotificationItem)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def mark_notification_read(
    request: Request,  # noqa: ARG001
    notification_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Mark one of the reader's notifications read. 404 if not theirs."""
    ok = crud.mark_reader_notification_read(db, current_reader.id, notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    row = db.get(models.ReaderNotification, notification_id)
    if row is None:
        # mark_reader_notification_read reported an owned row but it vanished in
        # the same session (concurrent clear); surface 404 instead of an
        # unhandled assert (round-296 deep-dive).
        raise HTTPException(status_code=404, detail="Notification not found")
    return NotificationItem(
        id=row.id,
        kind=row.kind,
        title=row.title,
        body=row.body,
        url=row.url,
        read=row.read_at is not None,
        created_at=row.created_at,
    )


@router.delete("/me/notifications/{notification_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def delete_notification(
    request: Request,  # noqa: ARG001
    notification_id: IdInt,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Delete one of the reader's inbox rows. 404 if not theirs.

    The inbox is durable (DEC-160) but consumers had no way to prune it — mark
    read/read-all clear the badge, rows accumulate forever. This removes exactly
    one of the reader's own notifications (reader_id-scoped like every reader
    table), so an unknown or another reader's id is a 404, never a cross-reader
    delete. (DEC-312, TASK-384)
    """
    ok = crud.delete_reader_notification(db, current_reader.id, notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")


@router.post("/me/notifications/read-all", response_model=dict[str, int])
@limiter.limit(f"{RATE_LIMIT_WRITE}/minute")
def mark_all_notifications_read(
    request: Request,  # noqa: ARG001
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Mark every unread notification read; returns the count updated."""
    updated = crud.mark_all_reader_notifications_read(db, current_reader.id)
    return {"updated": updated}


# Reader notification preferences (DEC-171, TASK-202)
# ---------------------------------------------------------------------------


class NotificationPrefs(BaseModel):
    """A reader's per-kind notification state; every field true = all on.

    Mirrors the ReaderNotificationPref row. Missing rows read as all-on for the
    push/inbox kinds, so a reader who never opened the preferences surface is
    unaffected. The email_* fields are the opt-in email channel (DEC-197,
    TASK-217): they default false — a missing row reads as no email at all.
    """

    new_post: bool
    reply: bool
    thread_comment: bool
    # @-mentions (DEC-322, TASK-389): durable inbox rows when an approved
    # comment names this reader's display name as @<name>.
    mention: bool
    # Reader-to-reader follow (round 365, DEC-403): durable inbox rows when
    # an approved comment by a reader the reader FOLLOWS lands.
    reader_comment: bool
    email_new_post: bool
    email_reply: bool
    email_thread_comment: bool
    # Email copy of @-mentions (DEC-326, TASK-391): offline delivery of the
    # most personal notification, off by default like the other email_* kinds.
    email_mention: bool
    # Recurring digest opt-in (DEC-201, TASK-222): one aggregated weekly email,
    # independent of the per-event toggles above.
    email_weekly_digest: bool


class NotificationPrefUpdate(BaseModel):
    """Body for toggling one notification kind (DEC-171, TASK-202)."""

    kind: str
    enabled: bool


@router.get("/me/notification-preferences", response_model=NotificationPrefs)
def get_my_notification_prefs(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The signed-in reader's per-kind notification opt-outs, all-on by default.

    Auth-scoped like the inbox; the global middleware defaults these to no-store
    (per-reader data). Materializes an all-on row on first read so the response
    is always the full object.
    """
    prefs = crud.get_reader_notification_prefs(db, current_reader.id)
    return NotificationPrefs(
        new_post=prefs.new_post,
        reply=prefs.reply,
        thread_comment=prefs.thread_comment,
        mention=prefs.mention,
        reader_comment=prefs.reader_comment,
        email_new_post=prefs.email_new_post,
        email_reply=prefs.email_reply,
        email_thread_comment=prefs.email_thread_comment,
        email_mention=prefs.email_mention,
        email_weekly_digest=prefs.email_weekly_digest,
    )


@router.patch("/me/notification-preferences", response_model=NotificationPrefs)
def set_my_notification_pref(
    payload: NotificationPrefUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Toggle one notification kind for the signed-in reader. 422 on unknown kind.

    A kind turned off stops it at every dispatch point — the reader gets neither
    a durable inbox row nor a browser push for that kind. Returns the full
    updated preferences.
    """
    prefs = crud.set_reader_notification_kind(db, current_reader.id, payload.kind, payload.enabled)
    if prefs is None:
        raise HTTPException(status_code=422, detail=f"Unknown notification kind: {payload.kind}")
    return NotificationPrefs(
        new_post=prefs.new_post,
        reply=prefs.reply,
        thread_comment=prefs.thread_comment,
        mention=prefs.mention,
        reader_comment=prefs.reader_comment,
        email_new_post=prefs.email_new_post,
        email_reply=prefs.email_reply,
        email_thread_comment=prefs.email_thread_comment,
        email_mention=prefs.email_mention,
        email_weekly_digest=prefs.email_weekly_digest,
    )


class ReaderLocaleUpdate(BaseModel):
    """Body for PUT /me/locale: the reader's notification-copy language.

    Only the two frontend locale codes are accepted (DEC-338/TASK-395); anything
    else is a 422 rather than a silently-stored unknown value.
    """

    locale: Literal["en", "zh"]


@router.put("/me/locale", response_model=ReaderLocaleUpdate)
def set_my_reader_locale(
    payload: ReaderLocaleUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Set the reader's notification-copy language (DEC-338, TASK-395).

    The fan-out picks the reader's durable inbox titles + email copy from this
    stored value (default zh when never set). The UI language switcher calls
    this when a signed-in reader changes their language, so an English reader
    stops receiving 新文章发布 / 系列更新 rows and emails immediately.
    """
    crud.set_reader_locale(db, current_reader.id, payload.locale)
    return payload
