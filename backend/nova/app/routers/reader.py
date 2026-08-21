"""Reader account endpoints: self-registration, login, current profile.

Reader accounts are the identity layer for cloud-synced bookmarks (DEC-059,
TASK-131). They are deliberately separate from admin ``User`` accounts — both
in table (``reader_accounts``) and in JWT audience (``aud=x-blog-reader``) —
so a self-registering reader can never hold a credential that reaches admin
endpoints (enforced in auth.get_current_user / get_current_reader).
"""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
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
# $) so a trailing newline cannot sneak past the anchor.
_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+\z"


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
    them transparently. Deliberately omits full content/views/likes — a
    bookmark list is a navigation list, not an article dump.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    slug: str
    excerpt: str | None = None
    cover_image: str | None = None
    created_at: datetime | None = None
    category: schemas.Category | None = None
    tags: list[schemas.Tag] = []

    @classmethod
    def from_post(cls, post: models.Post) -> BookmarkItem:
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
            category=(schemas.Category.model_validate(post.category) if post.category else None),
            tags=[schemas.Tag.model_validate(t) for t in post.tags],
        )


class BookmarkListResponse(BaseModel):
    items: list[BookmarkItem]
    total: int


class AddBookmarkResponse(BaseModel):
    post_id: int
    # True when the bookmark was newly created, False when it already existed
    # (idempotent re-put during merge). Lets the client skip a redundant sync.
    already_existed: bool


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
    db: Session = Depends(get_db),
):
    """List the reader's bookmarked posts (publicly-visible only).

    Non-public posts (draft/scheduled/unpublished) are excluded — a bookmark
    list is a read path and must not leak post existence/visibility changes.
    Newest bookmark first (the natural "recently saved" ordering).
    """
    posts = crud.list_reader_bookmarks(db, current_reader.id)
    return BookmarkListResponse(
        items=[BookmarkItem.from_post(p) for p in posts],
        total=len(posts),
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


class ReaderCommentItem(schemas.CommentPublic):
    """A reader's own comment, its moderation status, plus the post it was left
    on (for navigation). `status` is derived: approved / rejected (reviewed and
    declined) / pending (awaiting review). (DEC-066, TASK-139)"""

    status: Literal["pending", "approved", "rejected"]
    post: schemas.CommentPostBrief | None = None


class ReaderCommentListResponse(BaseModel):
    items: list[ReaderCommentItem]
    total: int


def _comment_status(c: models.Comment) -> Literal["pending", "approved", "rejected"]:
    if c.is_approved:
        return "approved"
    if c.reviewed_at is not None:
        return "rejected"
    return "pending"


@router.get("/me/comments", response_model=ReaderCommentListResponse)
def list_my_comments(
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """The reader's own comment history across statuses (DEC-066, TASK-139).

    A moderated blog hides pending/rejected comments from everyone but their
    author; this endpoint shows the caller's own comments with a derived
    status (pending / approved / rejected) plus the post they were left on so
    the frontend can link back. Anonymous readers have no history.
    """
    comments = crud.get_reader_comments(db, current_reader.id)
    items = []
    for c in comments:
        base = schemas.CommentPublic.model_validate(c).model_dump()
        post = db.get(models.Post, c.post_id)
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
    return ReaderCommentListResponse(items=items, total=len(items))


@router.delete("/me/comments/{comment_id}", status_code=204)
def delete_my_comment(
    comment_id: int,
    current_reader: auth.ReaderAccount = Depends(auth.get_current_reader),
    db: Session = Depends(get_db),
):
    """Delete one of the reader's own comments (any status).

    Scoped to the caller: another reader's comment (or a missing id) is a 404,
    indistinguishable from a non-existent resource so comment ids are not
    enumerable. Admin delete (DELETE /api/comments/{id}) is unchanged.
    """
    try:
        deleted = crud.delete_reader_comment(db, comment_id, current_reader.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found")
    return None
