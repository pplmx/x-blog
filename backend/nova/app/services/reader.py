"""
Reader service: reader account, bookmarks, follows, history, notifications, comments, series/tag/category follows -- the aggregate reader domain.
"""

from __future__ import annotations

import re
from datetime import timedelta
from pathlib import Path
from secrets import token_urlsafe
from uuid import uuid4

import pyotp
from PIL import UnidentifiedImageError
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth, emailer
from app.exceptions import AppException, ErrorCode
from app.image_validation import (
    ALLOWED_TYPES,
    ALLOWED_TYPES_MAP,
    MAX_SIZE,
    has_matching_magic_bytes,
    optimize_image,
    verify_image_decodes,
)
from app.middleware import get_logger
from app.repositories._base import (
    is_publicly_visible,
    utc_now_naive,
)
from app.repositories.bookmarks import (
    add_reader_bookmark,
    add_reader_post_like,
    clear_reader_bookmarks,
    create_bookmark_folder,
    delete_bookmark_folder,
    get_bookmark_folder,
    list_reader_bookmark_folders,
    list_reader_bookmarks,
    list_reader_post_likes,
    list_reader_public_bookmarks,
    remove_reader_bookmark,
    remove_reader_post_like,
    rename_bookmark_folder,
    set_bookmark_folder,
    set_reader_bookmark_done,
)
from app.repositories.categories import (
    get_category,
)
from app.repositories.comments import (
    approve_comment,
    delete_reader_comment,
    get_reader_comments,
    list_reader_public_comments,
    update_reader_comment,
)
from app.repositories.follows import (
    add_author_follow,
    add_category_follow,
    add_reader_block,
    add_reader_follow,
    add_series_follow,
    add_tag_follow,
    count_reader_followers,
    follows_feed_posts,
    get_reader_block,
    is_following_reader,
    list_reader_author_follows,
    list_reader_blocks,
    list_reader_category_follows,
    list_reader_follows,
    list_reader_series_follows,
    list_reader_tag_follows,
    remove_author_follow,
    remove_category_follow,
    remove_reader_block,
    remove_reader_follow,
    remove_series_follow,
    remove_tag_follow,
    set_author_follow_notify,
    set_category_follow_notify,
    set_series_follow_notify,
    set_tag_follow_notify,
)
from app.repositories.notifications import (
    delete_reader_notification,
    get_reader_notification_prefs,
    list_reader_notifications,
    mark_all_reader_notifications_read,
    mark_reader_notification_read,
    maybe_notify_due_scheduled_posts,
    set_reader_locale,
    set_reader_notification_kind,
    suggest_mention_readers,
    unread_notification_count,
)
from app.repositories.reader import (
    delete_reader_account,
    get_reader_public_profile,
)
from app.repositories.reading_history import (
    clear_reader_history,
    export_reader_data,
    get_reading_history,
    import_reader_history,
    list_reader_history,
    list_reader_in_progress,
    reader_history_insights,
    reader_history_stats,
    reader_series_progress,
    recommend_posts,
    record_reading_history,
)
from app.repositories.series import (
    get_series_by_slug,
)
from app.repositories.settings import (
    boolean_setting,
)
from app.repositories.subscriptions import (
    list_reader_comment_subscriptions,
)

logger = get_logger(__name__)

#: Time-to-live of an email-change verification link (mirrors the password-reset
#: window: long enough to reach the new inbox, short enough to expire stale
#: links). The pending change is cleared when it lapses (DEC-357, TASK-404).
EMAIL_CHANGE_TTL_MINUTES = 60

# Reader avatar storage lives in a dedicated static/avatars/ namespace, NOT the
# admin media library's static/uploads/ (DEC-299/TASK-378): the admin media
# listing walks static/uploads/ only, so a reader's profile picture must not
# appear in or collide with the author's uploaded post images. The directory
# itself is owned by the router (which passes it to these functions); only the
# filename whitelist and best-effort cleanup live here.
# Avatars are stored as `{uuid4}.{ext}` (same shape as media uploads); the
# remove path whitelists the exact shape so a DB value can never become a
# filesystem path outside the avatar dir (mirrors upload.py's _FILENAME_RE).
_AVATAR_FILENAME_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|gif|webp)$"
)


def _delete_avatar_file(avatar_dir: Path, avatar_url: str | None) -> None:
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
    path = avatar_dir / name
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("could not remove stale avatar file %s", path)


async def update_my_profile(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
    updates: dict,
) -> auth.ReaderAccount:
    """Update the reader's own profile (display_name, bio, public-likes opt-in).

    ``updates`` is the payload's ``model_dump(exclude_unset=True)`` so the
    bio/public flags follow the exclude_unset contract: only explicitly-present
    keys are applied. Email changes are their own verified flow
    (/me/email/request + /me/email/confirm, DEC-357).
    """
    if "display_name" in updates:
        current_reader.display_name = updates["display_name"]
    if "bio" in updates:
        current_reader.bio = updates["bio"]
    if "public_likes" in updates:
        current_reader.public_likes = bool(updates["public_likes"])
    if "public_bookmarks" in updates:
        current_reader.public_bookmarks = bool(updates["public_bookmarks"])
    await db.commit()
    await db.refresh(current_reader)
    return current_reader


async def upload_my_avatar(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
    content_type: str | None,
    contents: bytes,
    avatar_dir: Path,
) -> auth.ReaderAccount:
    """Set the reader's profile picture (replaces any existing one).

    Same defense-in-depth validation as the admin image upload (content-type
    whitelist, size cap, magic bytes, full Pillow decode, never-larger re-encode
    that strips EXIF) — shared via app.image_validation so the two upload
    surfaces can't drift apart (DEC-299/TASK-378). The new avatar is written to
    static/avatars/ first, then the DB row is updated and any previous avatar
    file removed, so a failed write never leaves a dangling avatar_url.
    """
    if content_type not in ALLOWED_TYPES:
        raise ValueError("Unsupported file type")
    # Cap memory: read at most MAX_SIZE+1 bytes and reject before an oversized
    # body balloons RAM (reading the whole stream first would buffer it all).
    if len(contents) > MAX_SIZE:
        raise ValueError("File too large (max 5MB)")
    if not has_matching_magic_bytes(contents, content_type):
        raise ValueError("File content does not match the declared image type")
    try:
        verify_image_decodes(contents)
    except UnidentifiedImageError, OSError, ValueError:
        raise ValueError("File is not a valid image")

    contents = optimize_image(contents, content_type)

    ext = ALLOWED_TYPES_MAP.get(content_type, "jpg")
    filename = f"{uuid4()}.{ext}"
    avatar_dir.mkdir(parents=True, exist_ok=True)
    filepath = avatar_dir / filename
    filepath.write_bytes(contents)

    avatar_url = f"/static/avatars/{filename}"
    previous = current_reader.avatar_url
    current_reader.avatar_url = avatar_url
    await db.commit()
    await db.refresh(current_reader)
    _delete_avatar_file(avatar_dir, previous)
    return current_reader


async def remove_my_avatar(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
    avatar_dir: Path,
) -> auth.ReaderAccount:
    """Remove the reader's profile picture (stored file + DB row)."""
    previous = current_reader.avatar_url
    if previous:
        current_reader.avatar_url = None
        await db.commit()
        await db.refresh(current_reader)
        _delete_avatar_file(avatar_dir, previous)
    return current_reader


async def change_my_password(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
    current_password: str,
    new_password: str,
) -> tuple[auth.ReaderAccount, str]:
    """Rotate the reader's password, revoking all other sessions.

    Verifies the current password (same timing-safe helper as login), then
    bumps ``token_version`` so every pre-change reader JWT is rejected, and
    returns a fresh token (with the updated reader) for this session. Raises
    ``AppException``(401) when the current password is wrong.
    """
    if not auth.verify_password(current_password, current_reader.password):
        raise AppException(ErrorCode.UNAUTHORIZED, "Incorrect current password", status_code=401)
    current_reader.password = auth.get_password_hash(new_password)
    current_reader.token_version = (current_reader.token_version or 0) + 1
    await db.commit()
    await db.refresh(current_reader)

    access_token = auth.create_reader_token({"sub": current_reader.id}, token_version=current_reader.token_version or 0)
    return current_reader, access_token


async def setup_two_factor(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
) -> dict[str, str]:
    """Generate fresh TOTP enrollment material (round 364, DEC-401).

    Returns a new base32 secret + an otpauth:// provisioning URI (for an
    authenticator QR or manual entry). Nothing is ENABLED yet — the reader must
    prove possession via /me/2fa/enable. A repeat call before enabling simply
    generates a fresh secret (the previous enrollment is discarded); once
    enabled the secret is never re-exposed and this endpoint 409s.
    """
    if current_reader.two_factor_enabled:
        raise AppException(
            ErrorCode.OPERATION_NOT_ALLOWED,
            "Two-factor authentication is already enabled",
            status_code=409,
        )
    secret = pyotp.random_base32()
    current_reader.two_factor_secret = secret
    await db.commit()
    otpauth_uri = pyotp.TOTP(secret).provisioning_uri(name=current_reader.email, issuer_name="X-Blog")
    return {"secret": secret, "otpauth_uri": otpauth_uri}


async def enable_two_factor(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
    current_password: str,
    code: str,
) -> auth.ReaderAccount:
    """Prove the account AND the authenticator, then turn 2FA on.

    The current password is verified first (a session alone must not be able to
    enroll a factor the owner can't remove — security review MEDIUM, DEC-401),
    then the single code must match the stored seed. Either failure is a flat
    400 with no hint of which half was wrong. Once enabled, POST /login starts
    returning an mfa_token instead of an access token. Existing sessions stay
    valid — enabling a second factor does not log the reader out.
    """
    if not auth.verify_password(current_password, current_reader.password):
        raise ValueError("Incorrect current password")
    if current_reader.two_factor_enabled:
        raise AppException(
            ErrorCode.OPERATION_NOT_ALLOWED,
            "Two-factor authentication is already enabled",
            status_code=409,
        )
    if not current_reader.two_factor_secret:
        raise ValueError("Run /me/2fa/setup first")
    if not auth.verify_totp(current_reader.two_factor_secret, code):
        raise ValueError("Invalid authentication code")
    current_reader.two_factor_enabled = True
    await db.commit()
    return current_reader


async def disable_two_factor(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
    current_password: str,
    code: str,
) -> auth.ReaderAccount:
    """Turn 2FA back off — only with the current password AND a valid code.

    Both are required so neither a stolen session alone nor a stolen password
    alone can silently drop the second factor. On success the seed is cleared,
    so enrollment must restart from /me/2fa/setup.
    """
    if not auth.verify_password(current_password, current_reader.password):
        raise ValueError("Incorrect current password")
    if not current_reader.two_factor_enabled or not current_reader.two_factor_secret:
        raise ValueError("Two-factor authentication is not enabled")
    if not auth.verify_totp(current_reader.two_factor_secret, code):
        raise ValueError("Invalid authentication code")
    current_reader.two_factor_enabled = False
    current_reader.two_factor_secret = None
    await db.commit()
    return current_reader


async def request_email_change(
    db: AsyncSession,
    current_reader: auth.ReaderAccount,
    current_password: str,
    new_email: str,
) -> dict[str, str]:
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
    if not auth.verify_password(current_password, current_reader.password):
        raise AppException(ErrorCode.UNAUTHORIZED, "Incorrect current password", status_code=401)
    new_email = new_email.strip().lower()
    if new_email == current_reader.email:
        raise ValueError("New email must differ from the current email")
    occupied = (
        await db.execute(
            select(auth.ReaderAccount).where(
                func.lower(auth.ReaderAccount.email) == new_email,
                auth.ReaderAccount.id != current_reader.id,
            )
        )
    ).scalar_one_or_none()
    if occupied is not None:
        raise AppException(
            ErrorCode.DUPLICATE_NAME,
            "That email is already in use by another account",
            status_code=409,
        )
    if not emailer.is_email_configured():
        raise AppException(
            ErrorCode.SERVICE_UNAVAILABLE, "Email service is not configured on this server", status_code=503
        )

    token = token_urlsafe(32)
    current_reader.email_change_token = token
    current_reader.email_change_pending = new_email
    current_reader.email_change_requested_at = utc_now_naive()
    # Persist BEFORE sending (round 393): an email sent in front of an
    # uncommitted token leaves the reader holding a dead link if the commit
    # then fails (transient DB error) — the confirm step would find no row by
    # that token. On a send failure the just-persisted pending row is cleared
    # again (best-effort), so the "nothing staged on failure" guarantee holds
    # as before; a stale row that slips through self-expires via the
    # EMAIL_CHANGE_TTL_MINUTES and is overwritten on the next re-request.
    await db.commit()

    async def _clear_pending() -> None:
        current_reader.email_change_token = None
        current_reader.email_change_pending = None
        current_reader.email_change_requested_at = None
        await db.commit()

    try:
        accepted = emailer.send_email_change_email(new_email, token)
        if not accepted:
            # RFC-level refusal (e.g. the address provably bounces): nothing
            # staged, exactly as before the reorder.
            await _clear_pending()
            raise AppException(
                ErrorCode.SERVICE_UNAVAILABLE,
                "Could not send the verification email, please try again later",
                status_code=503,
            )
    except AppException:
        raise
    except Exception:
        logger.exception("email-change verification send raised")
        try:
            await _clear_pending()
        except Exception:  # noqa: BLE001 — never mask the primary 503
            await db.rollback()
        raise AppException(
            ErrorCode.SERVICE_UNAVAILABLE,
            "Could not send the verification email, please try again later",
            status_code=503,
        ) from None
    return {"message": "A verification link is on its way to the new address"}


async def confirm_email_change(
    db: AsyncSession,
    token: str,
) -> tuple[auth.ReaderAccount, str]:
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
    reader = (
        await db.execute(select(auth.ReaderAccount).where(auth.ReaderAccount.email_change_token == token))
    ).scalar_one_or_none()
    if reader is None or reader.email_change_pending is None:
        raise ValueError("Invalid or expired verification link")

    now = utc_now_naive()
    if reader.email_change_requested_at is None or now - reader.email_change_requested_at > timedelta(
        minutes=EMAIL_CHANGE_TTL_MINUTES
    ):
        # Expired — clear the stale pending so a re-request starts clean.
        reader.email_change_token = None
        reader.email_change_pending = None
        reader.email_change_requested_at = None
        await db.commit()
        raise ValueError("Invalid or expired verification link")

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
        await db.commit()
        raise ValueError("Invalid or expired verification link")

    target = reader.email_change_pending
    # Case-insensitive occupied check (the login path matches emails the same
    # defensive way): current writers always store lowercase, but a legacy
    # mixed-case address must trip a clean 409 rather than a unique-index 500.
    occupied = (
        await db.execute(
            select(auth.ReaderAccount).where(
                func.lower(auth.ReaderAccount.email) == target,
                auth.ReaderAccount.id != reader.id,
            )
        )
    ).scalar_one_or_none()
    if occupied is not None:
        reader.email_change_token = None
        reader.email_change_pending = None
        reader.email_change_requested_at = None
        await db.commit()
        raise AppException(
            ErrorCode.DUPLICATE_NAME,
            "That email is already in use; please request a new change",
            status_code=409,
        )

    # Atomic single-statement redeem (see docstring): both the swap and the
    # clear are conditional on the stored token still being the presented one,
    # so a concurrent double-click or a replaced pending token returns 400
    # (rowcount 0) instead of a second 200 / a lost newer pending.
    redeemed = (
        await db.execute(
            update(auth.ReaderAccount)
            .where(
                auth.ReaderAccount.id == reader.id,
                auth.ReaderAccount.email_change_token == token,
            )
            .values(
                {
                    "email": target,
                    "email_change_token": None,
                    "email_change_pending": None,
                    "email_change_requested_at": None,
                    "token_version": (reader.token_version or 0) + 1,
                    "last_login_at": now,
                }
            )
            .execution_options(synchronize_session=False)
        )
    ).rowcount  # type: ignore[reportAttributeAccessIssue]
    if redeemed == 0:
        await db.rollback()
        raise ValueError("Invalid or expired verification link")
    try:
        await db.commit()
    except IntegrityError:
        # The target address got taken (concurrent register/change) after the
        # occupied check — surface the business 409 and clear the stale pending
        # so the reader's next request starts clean, never a 500.
        await db.rollback()
        reader = (
            await db.execute(select(auth.ReaderAccount).where(auth.ReaderAccount.id == reader.id))
        ).scalar_one_or_none()
        if reader is not None:
            reader.email_change_token = None
            reader.email_change_pending = None
            reader.email_change_requested_at = None
            await db.commit()
        raise AppException(
            ErrorCode.DUPLICATE_NAME,
            "That email is already in use; please request a new change",
            status_code=409,
        ) from None
    await db.refresh(reader)
    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return reader, access_token


async def request_password_reset(db: AsyncSession, email: str) -> dict[str, str]:
    """Email a password-reset link, without revealing whether the address exists.

    Always returns the same 202 whether or not ``email`` maps to an account, so
    the endpoint is not an account-existence oracle (DEC-286, TASK-371 — the
    generic-response outcome DEC-060 wanted for register). The only non-202s are
    infrastructure 503s (SMTP unconfigured / send failed), which carry no
    account information either. A reset email is only sent to active accounts;
    a deactivated reader gets the same generic 202 with no mail, so a reset link
    can never be used to probe moderation state. Rate-limited like login.
    """
    normalized_email = email.lower().strip()
    if not emailer.is_email_configured():
        raise AppException(
            ErrorCode.SERVICE_UNAVAILABLE, "Email service is not configured on this server", status_code=503
        )
    reader = (
        await db.execute(
            select(auth.ReaderAccount).where(
                auth.ReaderAccount.email == normalized_email,
                auth.ReaderAccount.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    # Unknown email is not an error: the same generic 202 is what matters. Only
    # compose/send mail when an active account exists.
    if reader is not None:
        token = auth.create_password_reset_token(reader.id, token_version=reader.token_version or 0)
        try:
            accepted = emailer.send_password_reset_email(reader.email, token)
        except Exception:
            # Connection-level SMTP failure → infrastructure 503 (no account info).
            logger.exception("password-reset email send raised")
            raise AppException(
                ErrorCode.SERVICE_UNAVAILABLE,
                "Could not send the reset email, please try again later",
                status_code=503,
            )
        if not accepted:
            raise AppException(
                ErrorCode.SERVICE_UNAVAILABLE,
                "Could not send the reset email, please try again later",
                status_code=503,
            )
    # Generic success — the same body for known and unknown addresses.
    return {"message": "If that email is registered, a reset link is on its way"}


async def confirm_password_reset(
    db: AsyncSession,
    token: str,
    new_password: str,
) -> tuple[auth.ReaderAccount, str]:
    """Redeem a reset token: set a new password, revoke every session, and log in.

    ``get_reader_for_password_reset`` rejects expired/tampered/wrong-audience
    tokens and tokens older than the reader's current password epoch. On
    success the password is set and ``token_version`` is bumped (one bump — the
    password epoch the new token is issued under), which invalidates every
    previously issued reader JWT *and* this reset token (its ``ver`` no longer
    matches). The reader is auto-logged-in with a fresh token, mirroring
    register/password-change UX (DEC-286, TASK-371).
    """
    reader = await auth.get_reader_for_password_reset(token, db)
    if reader is None:
        raise ValueError("Invalid or expired reset link")
    reader.password = auth.get_password_hash(new_password)
    reader.token_version = (reader.token_version or 0) + 1
    await db.commit()
    await db.refresh(reader)
    reader.last_login_at = utc_now_naive()
    await db.commit()

    access_token = auth.create_reader_token({"sub": reader.id}, token_version=reader.token_version or 0)
    return reader, access_token


__all__ = [
    "add_author_follow",
    "add_category_follow",
    "add_reader_block",
    "add_reader_bookmark",
    "add_reader_follow",
    "add_reader_post_like",
    "add_series_follow",
    "add_tag_follow",
    "approve_comment",
    "boolean_setting",
    "change_my_password",
    "clear_reader_bookmarks",
    "clear_reader_history",
    "confirm_email_change",
    "confirm_password_reset",
    "count_reader_followers",
    "create_bookmark_folder",
    "delete_bookmark_folder",
    "delete_reader_account",
    "delete_reader_comment",
    "delete_reader_notification",
    "disable_two_factor",
    "enable_two_factor",
    "export_reader_data",
    "follows_feed_posts",
    "get_bookmark_folder",
    "get_category",
    "get_reader_block",
    "get_reader_comments",
    "get_reader_notification_prefs",
    "get_reader_public_profile",
    "get_reading_history",
    "get_series_by_slug",
    "import_reader_history",
    "is_following_reader",
    "is_publicly_visible",
    "list_reader_author_follows",
    "list_reader_blocks",
    "list_reader_bookmark_folders",
    "list_reader_bookmarks",
    "list_reader_category_follows",
    "list_reader_comment_subscriptions",
    "list_reader_follows",
    "list_reader_history",
    "list_reader_in_progress",
    "list_reader_notifications",
    "list_reader_post_likes",
    "list_reader_public_bookmarks",
    "list_reader_public_comments",
    "list_reader_series_follows",
    "list_reader_tag_follows",
    "mark_all_reader_notifications_read",
    "mark_reader_notification_read",
    "maybe_notify_due_scheduled_posts",
    "reader_history_insights",
    "reader_history_stats",
    "reader_series_progress",
    "recommend_posts",
    "record_reading_history",
    "remove_author_follow",
    "remove_category_follow",
    "remove_my_avatar",
    "remove_reader_block",
    "remove_reader_bookmark",
    "remove_reader_follow",
    "remove_reader_post_like",
    "remove_series_follow",
    "remove_tag_follow",
    "rename_bookmark_folder",
    "request_email_change",
    "request_password_reset",
    "set_author_follow_notify",
    "set_bookmark_folder",
    "set_category_follow_notify",
    "set_reader_bookmark_done",
    "set_reader_locale",
    "set_reader_notification_kind",
    "set_series_follow_notify",
    "set_tag_follow_notify",
    "setup_two_factor",
    "suggest_mention_readers",
    "unread_notification_count",
    "update_my_profile",
    "update_reader_comment",
    "upload_my_avatar",
    "utc_now_naive",
]
