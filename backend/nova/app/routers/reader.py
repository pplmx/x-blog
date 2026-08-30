"""Reader account endpoints: self-registration, login, current profile.

Reader accounts are the identity layer for cloud-synced bookmarks (DEC-059,
TASK-131). They are deliberately separate from admin ``User`` accounts — both
in table (``reader_accounts``) and in JWT audience (``aud=x-blog-reader``) —
so a self-registering reader can never hold a credential that reaches admin
endpoints (enforced in auth.get_current_user / get_current_reader).
"""

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.database import get_db
from app.limiter import RATE_LIMIT_AUTH, RATE_LIMIT_REGISTER, limiter

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
    created_at: datetime | None = None


class ReaderLoginResponse(BaseModel):
    access_token: str
    token_type: str
    reader: ReaderProfile


class ReaderRegister(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)
    # bcrypt only hashes the first 72 bytes of a password; capping input at 72
    # keeps the effective credential equal to the stored credential (a longer
    # password would silently truncate). (security review, TASK-131)
    password: str = Field(min_length=8, max_length=72)
    display_name: str | None = Field(default=None, min_length=1, max_length=50)


class ReaderLogin(BaseModel):
    email: str = Field(min_length=3, max_length=254, pattern=_EMAIL_PATTERN)
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
    category: schemas.Category | None = None
    tags: list[schemas.Tag] = []

    @classmethod
    def from_post(
        cls,
        post: models.Post,
        folder_id: int | None = None,
        folder_name: str | None = None,
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
    name: str = Field(min_length=1, max_length=50)


class FolderRename(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class AssignFolder(BaseModel):
    # None clears the bookmark's folder.
    folder_id: int | None = None


class BookmarkFolderResponse(BaseModel):
    id: int
    name: str


class AssignFolderResponse(BaseModel):
    post_id: int
    folder_id: int | None = None


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
    """A reader's portable data bundle (DEC-126/TASK-175)."""

    account: dict
    exported_at: str | None = None
    bookmarks: list[dict] = []
    comments: list[dict] = []
    history: list[dict] = []


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
    """

    scroll_position: int | None = Field(default=None, ge=0, le=10_000_000)


class ReadingPositionResponse(BaseModel):
    """A reader's saved resume offset for a post, for the post page to restore
    on return (null when the post has never been viewed)."""

    post_id: int
    scroll_position: int | None = None


class DayActivity(BaseModel):
    """One day's reads for the 52-week activity heatmap (DEC-169/TASK-201).

    ``date`` is the UTC date (ISO yyyy-mm-dd); ``count`` is how many publicly
    visible posts were read that day (0 days included so the heatmap renders
    without gaps).
    """

    date: str
    count: int


class ReadingStatsResponse(BaseModel):
    """A reader's reading summary derived from their history (DEC-118).

    Publicly-visible posts only — un-published posts neither leak nor count.
    ``recent`` mirrors the history-list item shape for continue-reading quick
    jumps. ``current_streak`` / ``longest_streak`` / ``activity`` power the
    gamification surface (DEC-169): the streak in consecutive active UTC days
    and the last 52 weeks of per-day read counts.
    """

    total_posts: int = 0
    total_reading_minutes: int = 0
    last_viewed_at: datetime | None = None
    recent: list[ReadingHistoryItem] = []
    current_streak: int = 0
    longest_streak: int = 0
    activity: list[DayActivity] = []


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
    """Authenticate a reader by email+password and return a reader-scoped JWT."""
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
    """Editable reader profile fields. Email is deliberately immutable (it is
    the login identity and there is no email-verification recovery flow, so
    reassigning it silently would orphan the account)."""

    display_name: str | None = Field(default=None, min_length=1, max_length=50)


class ReaderPasswordChange(BaseModel):
    """Password rotation: verify the current one, set a new one.

    new_password bounds mirror registration (bcrypt only hashes the first 72
    bytes — equality between effective and stored credential requires the same
    cap on both ends, security review TASK-131)."""

    current_password: str = Field(min_length=1, max_length=72)
    new_password: str = Field(min_length=8, max_length=72)


class ReaderPasswordChangeResponse(BaseModel):
    access_token: str
    token_type: str
    reader: ReaderProfile


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
def update_my_profile(
    payload: ReaderProfileUpdate,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Update the reader's own profile (display_name). Email is immutable."""
    if payload.display_name is not None:
        current_reader.display_name = payload.display_name
    db.commit()
    db.refresh(current_reader)
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
    try:
        deleted = crud.delete_reader_account(db, current_reader.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Account not found")
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
def update_my_push_subscription_prefs(
    subscription_id: int,
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
def revoke_my_push_subscription(
    subscription_id: int,
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
    folder_id: int | None = Query(None, description="filter to this folder"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List the reader's bookmarked posts (publicly-visible only), paginated.

    Non-public posts (draft/scheduled/unpublished) are excluded — a bookmark
    list is a read path and must not leak post existence/visibility changes.
    Newest bookmark first (the natural "recently saved" ordering). Optional
    ``folder_id`` filters to that folder (DEC-120/TASK-172). Bounded paging
    (page/limit, max 100) keeps setup/merge calls from loading every row
    (ISS-142); clients that need the full set page through ``total_pages``.
    """
    rows, total = crud.list_reader_bookmarks(db, current_reader.id, folder_id=folder_id, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    return BookmarkListResponse(
        items=[BookmarkItem.from_post(p, fid, fname) for p, fid, fname in rows],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.get("/me/post-subscriptions", response_model=SubscribedThreadListResponse)
def list_my_post_subscriptions(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    page: int = Query(1, ge=1),
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
def add_bookmark(
    post_id: int,
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
def clear_bookmarks(
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
def remove_bookmark(
    post_id: int,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Remove a bookmark. Idempotent: deleting a non-existent bookmark is a
    204 no-op (merge-friendly)."""
    crud.remove_reader_bookmark(db, current_reader.id, post_id)
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
def create_bookmark_folder(
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
def rename_bookmark_folder(
    folder_id: int,
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
def delete_bookmark_folder(
    folder_id: int,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Delete a folder (its bookmarks become uncategorized). Idempotent 204."""
    crud.delete_bookmark_folder(db, current_reader.id, folder_id)
    return None


@router.patch("/me/bookmarks/{post_id}/folder", response_model=AssignFolderResponse)
def assign_bookmark_folder(
    post_id: int,
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
def export_my_data(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Return the caller's portable data bundle (account, bookmarks, comments,
    history). Auth-scoped — only the signed-in reader's own data (DEC-126)."""
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


@router.get("/me/follows-feed", response_model=list[schemas.PostList])
def my_follows_feed(
    limit: int = Query(12, ge=1, le=50),
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Recent public posts from the reader's followed categories + series (DEC-142/TASK-183)."""
    posts = crud.follows_feed_posts(db, current_reader.id, limit=limit)
    return [schemas.PostList.model_validate(p) for p in posts]


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
def follow_series(
    series_id: int,
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
def set_series_follow_notify(
    series_id: int,
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
def unfollow_series(
    series_id: int,
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
def follow_category(
    category_id: int,
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
def set_category_follow_notify(
    category_id: int,
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
def unfollow_category(
    category_id: int,
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
def follow_tag(
    tag_id: int,
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
def set_tag_follow_notify(
    tag_id: int,
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
def unfollow_tag(
    tag_id: int,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Unfollow a tag. Idempotent 204."""
    crud.remove_tag_follow(db, current_reader.id, tag_id)
    return None


# Server-backed reading history (DEC-116/TASK-170)
# ---------------------------------------------------------------------------


@router.get("/me/history", response_model=ReadingHistoryListResponse)
def list_reading_history(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, description="filter history to posts matching this term"),
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


@router.get("/me/history/stats", response_model=ReadingStatsResponse)
def reading_history_stats(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """A reader's reading summary (posts read, minutes, latest activity)."""
    stats = crud.reader_history_stats(db, current_reader.id, recent_limit=6)
    return ReadingStatsResponse(
        total_posts=stats["total_posts"],
        total_reading_minutes=stats["total_reading_minutes"],
        last_viewed_at=stats["last_viewed_at"],
        recent=[ReadingHistoryItem.from_post(p, viewed_at) for p, viewed_at in stats["recent"]],
        current_streak=stats["current_streak"],
        longest_streak=stats["longest_streak"],
        activity=[DayActivity(**a) for a in stats["activity"]],
    )


@router.get("/me/history/{post_id}", response_model=ReadingPositionResponse)
def reading_position(
    post_id: int,
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
    return ReadingPositionResponse(post_id=post_id, scroll_position=row.scroll_position if row else None)


@router.post("/me/history/{post_id}", response_model=RecordHistoryResponse)
def record_reading_view(
    post_id: int,
    body: RecordHistoryRequest | None = None,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Record a view on a public post (idempotent upsert).

    ``body`` is optional: omit it (or send ``scroll_position: null``) for a
    plain view that refreshes ``viewed_at`` without touching the saved resume
    position; send an explicit ``scroll_position`` to update it (DEC-167).
    Drafts/scheduled/unknown posts are uniformly 404 — no draft-existence
    oracle (same guard as the bookmark/comment paths).
    """
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    scroll_position = body.scroll_position if body is not None else None
    row, created = crud.record_reading_history(db, current_reader.id, post.id, scroll_position)
    return RecordHistoryResponse(post_id=row.post_id, already_existed=not created)


@router.delete("/me/history", status_code=204)
def clear_reading_history(
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
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """The reader's own comment history with a status filter + pagination.

    A moderated blog hides pending/rejected comments from everyone but their
    author; this endpoint shows the caller's own comments with a derived
    status (pending / approved / rejected) plus the post they were left on so
    the frontend can link back. Anonymous readers have no history. ``status``
    is whitelisted and unknown values are rejected with 422 (DEC-102/TASK-163).
    """
    if status not in VALID_READER_COMMENT_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {list(VALID_READER_COMMENT_STATUSES)}")
    comments, total = crud.get_reader_comments(db, current_reader.id, status=status, page=page, limit=limit)
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
def delete_my_comment(
    comment_id: int,
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

    content: str = Field(max_length=5000)


@router.patch("/me/comments/{comment_id}", response_model=schemas.CommentPublic)
def edit_my_comment(
    comment_id: int,
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
    """
    updated = crud.update_reader_comment(db, comment_id, current_reader.id, edit.content)
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
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
    page: int = Query(1, ge=1),
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
def mark_notification_read(
    notification_id: int,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Mark one of the reader's notifications read. 404 if not theirs."""
    ok = crud.mark_reader_notification_read(db, current_reader.id, notification_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Notification not found")
    row = db.get(models.ReaderNotification, notification_id)
    assert row is not None  # mark_reader_notification_read returned True only for an owned row
    return NotificationItem(
        id=row.id,
        kind=row.kind,
        title=row.title,
        body=row.body,
        url=row.url,
        read=row.read_at is not None,
        created_at=row.created_at,
    )


@router.post("/me/notifications/read-all", response_model=dict[str, int])
def mark_all_notifications_read(
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
    email_new_post: bool
    email_reply: bool
    email_thread_comment: bool
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
        email_new_post=prefs.email_new_post,
        email_reply=prefs.email_reply,
        email_thread_comment=prefs.email_thread_comment,
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
        email_new_post=prefs.email_new_post,
        email_reply=prefs.email_reply,
        email_thread_comment=prefs.email_thread_comment,
        email_weekly_digest=prefs.email_weekly_digest,
    )
