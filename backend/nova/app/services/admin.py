"""
Admin service: admin post lifecycle (create/clone/update/revisions) with the new-post notification + newsletter/push fan-out, and comment moderation orchestration.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from pathlib import Path
from uuid import uuid4

from PIL import UnidentifiedImageError
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import auth, models
from app.auth import ROLE_EDITOR
from app.cache import (
    clear_categories_cache,
    clear_posts_list_cache,
    clear_tags_cache,
)
from app.dates import (
    inclusive_end_of_day,
    parse_bound,
)
from app.emailer import (
    dispatch_newsletter_new_post,
)
from app.exceptions import (
    AppException,
    ErrorCode,
)
from app.image_validation import (
    ALLOWED_TYPES,
    ALLOWED_TYPES_MAP,
    MAX_SIZE,
    has_matching_magic_bytes,
    optimize_image,
    verify_image_decodes,
)
from app.repositories._base import (
    escape_like_pattern,
    is_publicly_visible,
    utc_now_naive,
)
from app.repositories.categories import (
    get_category,
)
from app.repositories.comments import (
    bulk_delete_comments,
    delete_comment_reparent,
    flag_counts_for_comments,
)
from app.repositories.comments import (
    dismiss_comment_flags as _dismiss_comment_flags,
)
from app.repositories.notifications import (
    record_new_post_notifications,
)
from app.repositories.posts import (
    capture_post_revision,
    clone_post,
    create_post,
    delete_post,
    get_post_revision,
    get_post_revisions,
    record_slug_redirect,
    restore_post_revision,
)
from app.repositories.settings import (
    boolean_setting,
    upsert_site_setting,
)
from app.services.comments import (
    _notify_comment_approved,
)
from app.webpush import dispatch_new_post

logger = logging.getLogger(__name__)

__all__ = [
    "batch_approve_comments",
    "boolean_setting",
    "bulk_delete_comments",
    "change_password",
    "clone_post",
    "create_category",
    "create_post",
    "create_tag",
    "create_user",
    "delete_category",
    "delete_comment",
    "delete_post",
    "delete_tag",
    "delete_user",
    "dismiss_comment_flags",
    "escape_like_pattern",
    "get_category",
    "get_post_revision",
    "get_post_revisions",
    "list_comments",
    "list_posts",
    "list_readers",
    "list_users",
    "notify_post_published",
    "remove_user_avatar",
    "reply_comment",
    "restore_post_revision",
    "update_category",
    "update_post",
    "update_tag",
    "update_user",
    "upload_user_avatar",
    "upsert_site_setting",
    "utc_now_naive",
]


async def notify_post_published(db, post, logger) -> None:
    """Fan-out a post that just became publicly visible (DEC-336/TASK-394).

    Shared by the admin editor's publish transition and the create/update
    fan-out paths: stamp the exactly-once ``new_post_notified_at`` marker, then
    dispatch the durable reader inbox rows, the Web Push payload, and the
    newsletter email — best-effort fan-out that must never fail the publish.
    """
    post.new_post_notified_at = utc_now_naive()
    await db.commit()
    await record_new_post_notifications(db, post)
    await dispatch_new_post(db, post, logger)
    await dispatch_newsletter_new_post(db, post, logger)


async def update_post(
    db: AsyncSession,
    post_id: int,
    data: dict,
    logger: logging.Logger,
) -> dict:
    """Apply the admin editor's post-edit transaction (PUT /posts/{id}).

    ``data`` is the ``PostUpdate`` payload's ``model_dump(exclude_unset=True)``
    so the clearing-capable fields (cover_image, category_id, series_id,
    series_order, publish_at) follow the exclude_unset contract — only
    explicitly-present keys are applied, so a bare title/slug update never
    silently drops a category/series membership. Raises ``AppException`` for
    unknown ids / duplicate slugs / a missing post.
    """
    post = (
        (await db.execute(select(models.Post).options(joinedload(models.Post.tags)).where(models.Post.id == post_id)))
        .unique()
        .scalars()
        .first()
    )
    if not post:
        raise AppException(ErrorCode.POST_NOT_FOUND, "Post not found", status_code=404)

    # Notify on the draft/scheduled -> published transition made from the admin
    # editor, matching the admin_service.update_post fan-out (ate fan-out would silently
    # skip every reader's durable inbox row + Web Push for editor-published
    # posts — surfacing as "published but no one got notified").
    was_visible = is_publicly_visible(post)

    if data.get("title") is not None:
        post.title = data["title"]
    slug = data.get("slug")
    if slug is not None and slug != post.slug:
        # Slug-change redirect (round 350): an old URL that was shared/indexed
        # must keep pointing at this post after the rename (see admin_service.record_*).
        await record_slug_redirect(db, "post", post.slug, slug)
        post.slug = slug
    if data.get("content") is not None:
        post.content = data["content"]
    if data.get("excerpt") is not None:
        post.excerpt = data["excerpt"]
    if data.get("published") is not None:
        post.published = data["published"]
    if data.get("pinned") is not None:
        post.pinned = data["pinned"]
    if data.get("comments_enabled") is not None:
        # Per-post comments toggle (round 351): explicit value, never cleared
        # to None (the column is non-nullable).
        post.comments_enabled = data["comments_enabled"]
    if data.get("author_id") is not None:
        # Author reassignment (DEC-359/TASK-405, TASK-479/ISS-555): null is
        # never sent (authors aren't cleared), so any non-null value is an
        # explicit reassignment — and an id that no longer exists must 400 like
        # the sibling FK fields (author: null, 404 writer archive/RSS, missed
        # author-follow fan-out otherwise).
        author = (await db.execute(select(auth.User).where(auth.User.id == data["author_id"]))).scalar_one_or_none()
        if not author:
            raise AppException(
                ErrorCode.INVALID_INPUT,
                f"Author with id {data['author_id']} not found",
                status_code=400,
            )
        post.author_id = data["author_id"]

    # Fields that support explicit clearing (null) are handled via
    # model_dump(exclude_unset=True), which distinguishes "omitted" from
    # "explicitly null".
    if "cover_image" in data:
        # Explicit null clears the cover image (same semantics as category_id).
        post.cover_image = data["cover_image"]

    if "category_id" in data:
        category_id = data["category_id"]
        if category_id is not None:
            category = (
                await db.execute(select(models.Category).where(models.Category.id == category_id))
            ).scalar_one_or_none()
            if not category:
                raise AppException(
                    ErrorCode.INVALID_INPUT,
                    f"Category with id {category_id} not found",
                    status_code=400,
                )
            post.category_id = category_id
        else:
            post.category_id = None

    # Series membership (DEC-056/TASK-123): the editor must be able to assign a
    # post to a series (null = clear membership), mirroring admin_service.update_post — a
    # bare title/slug update must never silently drop the post out of its series.
    if "series_id" in data:
        series_id = data["series_id"]
        if series_id is not None:
            series = (await db.execute(select(models.Series).where(models.Series.id == series_id))).scalar_one_or_none()
            if not series:
                raise AppException(
                    ErrorCode.INVALID_INPUT,
                    f"Series with id {series_id} not found",
                    status_code=400,
                )
            post.series_id = series_id
        else:
            post.series_id = None
    if "series_order" in data:
        post.series_order = data["series_order"] or 0

    tag_id_list = data.get("tag_ids")
    if tag_id_list is not None:
        # Same unknown-id contract as category_id/series_id above: an id that no
        # longer exists is a stale/dropped selection, not a silent no-op — the
        # editor asked to associate a tag that isn't there. (Deep-dive: previously
        # unknown tag_ids were silently filtered out while the same handler 400'd
        # on an unknown category/series id, so a deleted tag vanished from a save.)
        tags = (await db.execute(select(models.Tag).where(models.Tag.id.in_(tag_id_list)))).scalars().all()
        if len(tags) != len(tag_id_list):
            missing = [tid for tid in tag_id_list if tid not in {t.id for t in tags}]
            raise AppException(
                ErrorCode.INVALID_INPUT,
                f"Tag(s) with id {missing} not found",
                status_code=400,
            )
        post.tags = list(tags)

    if "publish_at" in data:
        post.publish_at = data["publish_at"]

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppException(ErrorCode.DUPLICATE_SLUG, "Slug already exists", status_code=400)
    await db.refresh(post)
    # Snapshot the updated state into version history (DEC-158, TASK-191).
    # This route updates fields directly (it doesn't use admin_service.update_post), so
    # the capture is invoked here explicitly.
    await capture_post_revision(db, post)
    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()

    # Transition into visibility (draft/scheduled -> published) must fan out
    # the same inbox + push notifications the admin_service.create/update paths do. The
    # frontmost publish path is the admin editor's PUT /posts/{id}, which used
    # to skip both — a follower/subscriber count that never moved.
    if not was_visible and is_publicly_visible(post):
        # Exactly-once stamp (DEC-336/TASK-394): this editor path fans out
        # directly (it does not route through admin_service.update_post), so it must set
        # the same durable stamp the fire-on-read sweep (maybe_notify_due_...)
        # checks — otherwise the first public read of a crossed scheduled post
        # edited here would re-announce it.
        await notify_post_published(db, post, logger)
    return {"id": post.id}


async def list_comments(
    db: AsyncSession,
    post_id: int | None,
    is_approved: bool | None,
    q: str | None,
    date_from: str | None,
    date_to: str | None,
    flagged: bool | None,
    page: int,
    limit: int,
) -> dict:
    """List comments with pagination + filters (bounded response, issue #20)."""
    stmt = select(models.Comment, models.Post.title).join(models.Post, models.Post.id == models.Comment.post_id)
    if post_id:
        stmt = stmt.where(models.Comment.post_id == post_id)
    if is_approved is not None:
        stmt = stmt.where(models.Comment.is_approved.is_(is_approved))
    if q:
        like = f"%{escape_like_pattern(q)}%"
        stmt = stmt.where(
            or_(
                models.Comment.nickname.ilike(like, escape="\\"),
                models.Comment.email.ilike(like, escape="\\"),
                models.Comment.content.ilike(like, escape="\\"),
            )
        )
    if date_from or date_to:
        # FastAPI previously type-enforced these as datetimes (422 on garbage).
        # They're raw strings now so a date-only date_to can be widened to
        # end-of-day; the shared helpers keep the 422 contract and normalize
        # tz-aware input to naive UTC (same as the search route).
        start = parse_bound(date_from)
        end = parse_bound(inclusive_end_of_day(date_to)) if date_to else None
        if start is not None:
            stmt = stmt.where(models.Comment.created_at >= start)
        if end is not None:
            stmt = stmt.where(models.Comment.created_at <= end)
    if flagged is not None:
        flagged_ids = select(models.CommentFlag.comment_id)
        if flagged:
            stmt = stmt.where(models.Comment.id.in_(flagged_ids))
        else:
            stmt = stmt.where(models.Comment.id.notin_(flagged_ids))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    # Global moderation backlog, independent of the page's post/q/status filters:
    # the header's "N pending" must not be the current page's pending rows (which
    # reads 0 on an approved-heavy page while the queue still has work), nor the
    # filter-scoped total. Same authoritative pending_count the dashboard uses
    # (round 276); a tiny COUNT over one boolean-filtered column.
    pending_count = (
        await db.execute(select(func.count()).select_from(models.Comment).where(models.Comment.is_approved.is_(False)))
    ).scalar() or 0

    comment_rows = (
        await db.execute(
            stmt.order_by(models.Comment.created_at.desc(), models.Comment.id.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).all()
    page_ids = [c.id for c, _ in comment_rows]
    flag_counts = await flag_counts_for_comments(db, page_ids)
    # Reader account identity for the MODERATION queue (admin-only signal).
    # reader-attributed comments never put the account email in comment.email
    # (DEC-062), and round-427 stopped the old nickname fallback from leaking
    # it publicly (ISS-606) — but a moderator still needs to identify the
    # account behind a comment. Expose reader_email explicitly, on this trusted
    # admin surface only (alongside ip_address), never on a public schema.
    # Batched: one IN() lookup for the whole page, no per-row lazy load (N+1).
    reader_id_to_email: dict[int, str | None] = {}
    reader_ids = [c.reader_id for c, _ in comment_rows if c.reader_id is not None]
    if reader_ids:
        reader_rows = (
            await db.execute(
                select(auth.ReaderAccount.id, auth.ReaderAccount.email).where(auth.ReaderAccount.id.in_(reader_ids))
            )
        ).all()
        # C416: ruff prefers `dict(reader_rows)`, but pyright cannot type a
        # SQLAlchemy Row list into dict(); the explicit comprehension keeps
        # both green (`dict` on rows mis-infers bytes keys).
        reader_id_to_email = {rid: email for rid, email in reader_rows}  # noqa: C416
    result = []
    for c, post_title in comment_rows:
        result.append(
            {
                "id": c.id,
                "post_id": c.post_id,
                "post_title": post_title,
                "nickname": c.nickname,
                "email": c.email,
                # Admin-only: the comment author's ACCOUNT email when the
                # comment is reader-attributed (None for anonymous commenters,
                # mirroring comment.email). Never present on public schemas.
                "reader_email": reader_id_to_email.get(c.reader_id),
                "content": c.content,
                "ip_address": c.ip_address,
                "is_approved": c.is_approved,
                "is_author_reply": bool(c.is_author_reply),
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "flag_count": flag_counts.get(c.id, 0),
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
        "pending_count": pending_count,
    }


async def batch_approve_comments(db: AsyncSession, ids: list[int], approved: bool) -> dict:
    """Approve or reject a batch of comments, fanning out notifications for those
    that genuinely transitioned to approved (DEC-110 / round-296)."""
    comments = (await db.execute(select(models.Comment).where(models.Comment.id.in_(ids)))).scalars().all()
    # Idempotent: a comment already in the requested reviewed state (correct
    # is_approved AND reviewed_at stamped) is a no-op, so a re-approve of
    # already-approved comments must not re-fan out reply + thread
    # notifications (round-296 deep-dive — matches the single-approve guard in
    # comments.py). A *pending* comment (is_approved=False, reviewed_at NULL)
    # still enters `changed`: a reject must stamp reviewed_at or it would stay
    # in the moderation queue forever.
    changed = [c for c in comments if c.is_approved != approved or c.reviewed_at is None]
    for c in changed:
        c.is_approved = approved
        # Stamp reviewed_at on both outcomes so rejected comments leave the
        # moderation pending queue (get_pending_comments filters is_approved
        # AND reviewed_at is NULL) instead of lingering "pending" forever.
        # Mirrors admin_service.approve_comment's naive-UTC stamp (DEC-066, TASK-139;
        # ISS-452 keeps these writes consistent with the naive column).
        c.reviewed_at = utc_now_naive()
    if changed:
        await db.commit()
        # Approving/rejecting changes the approved comment_count embedded in the
        # cached public post list, so invalidate it (ISS-056).
        clear_posts_list_cache()
    # Notify replied-to readers + thread followers when comments are APPROVED
    # in bulk, the same as the single-approve path (comments.py APPROVE) — only
    # for comments that genuinely transitioned.
    if approved:
        for c in changed:
            await _notify_comment_approved(db, c)
    return {"message": f"{len(comments)} comments updated"}


async def delete_comment(db: AsyncSession, comment_id: int) -> None:
    """Delete a single comment (204), 404 when it is missing, reparenting its
    surviving replies so the thread is never orphaned (DEC-110)."""
    comment = (await db.execute(select(models.Comment).where(models.Comment.id == comment_id))).scalar_one_or_none()
    if not comment:
        raise AppException(ErrorCode.COMMENT_NOT_FOUND, "Comment not found", status_code=404)
    try:
        # Reparent surviving replies to the nearest surviving ancestor (or
        # top-level) so deleting a spam thread never orphans its replies or
        # refuses on Postgres — mirrors admin_service.bulk_delete_comments (DEC-110).
        # The old db.delete()+commit here orphaned replies on SQLite and 400'd
        # on Postgres whenever the comment had replies (backend deep-dive).
        deleted = await delete_comment_reparent(db, comment_id)
    except ValueError:
        await db.rollback()
        raise
    if not deleted:
        raise AppException(ErrorCode.COMMENT_NOT_FOUND, "Comment not found", status_code=404)


async def dismiss_comment_flags(db: AsyncSession, comment_id: int) -> dict:
    """Clear all reader flags on a comment (moderator dismissed the reports),
    404 when the comment does not exist."""
    comment = (await db.execute(select(models.Comment).where(models.Comment.id == comment_id))).scalar_one_or_none()
    if not comment:
        raise AppException(ErrorCode.COMMENT_NOT_FOUND, "Comment not found", status_code=404)
    removed = await _dismiss_comment_flags(db, comment_id)
    return {"comment_id": comment_id, "removed": removed}


async def reply_comment(
    db: AsyncSession,
    comment_id: int,
    content: str,
    ip_address: str,
    author_reply_nickname: str,
) -> models.Comment:
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
    comment = await db.get(models.Comment, comment_id)
    if comment is None:
        raise AppException(ErrorCode.COMMENT_NOT_FOUND, "Comment not found", status_code=404)

    reply = models.Comment(
        post_id=comment.post_id,
        parent_id=comment.id,
        nickname=author_reply_nickname,
        email=None,
        content=content,
        # Same proxy-aware resolver as the public comment path so the stored
        # IP matches the rate-limit bucket behind a trusted proxy.
        ip_address=ip_address,
        reader_id=None,
        is_approved=True,  # the author's reply needs no moderation (DEC-192)
        is_author_reply=True,
    )
    db.add(reply)
    try:
        await db.commit()
        await db.refresh(reply)
    except IntegrityError:
        await db.rollback()
        raise AppException(ErrorCode.INVALID_INPUT, "Failed to create reply", status_code=400)
    # Immediately public -> notify the replied-to reader + thread followers,
    # exactly as an approved comment would (no double paths to maintain).
    await _notify_comment_approved(db, reply)
    return reply


# ---------------------------------------------------------------------------
# Admin user-accounts (superuser surface) + author identity (DEC-359, TASK-405)
# ---------------------------------------------------------------------------


async def create_user(
    db: AsyncSession,
    username: str,
    password: str,
    display_name: str | None,
    bio: str | None,
) -> models.User:
    """Create an admin user account (superuser surface).

    Created accounts are always editors (non-superuser), never admins — a
    provisioned editor can moderate content but cannot manage users/export.
    This is the safe-contract fix for ISS-087 (DEC-053/DEC-054).
    """
    existing = (await db.execute(select(auth.User).where(auth.User.username == username))).scalar_one_or_none()
    if existing:
        raise ValueError("Username already exists")

    hashed_password = auth.get_password_hash(password)
    user = auth.User(
        username=username,
        password=hashed_password,
        role=ROLE_EDITOR,
        is_superuser=False,
        display_name=display_name,
        bio=bio,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Username already exists")
    await db.refresh(user)
    return user


async def update_user(db: AsyncSession, user_id: int, updates: dict) -> models.User:
    """Edit an admin user's public pen name and bio (superuser only).

    ``updates`` is the ``UserUpdate`` payload's ``model_dump(exclude_unset=True)``
    so ``display_name``/``bio`` distinguish "omitted" (don't change) from an
    explicit null (clear the byline/bio). The pen name/bio render on post
    bylines, series details and the RSS/Atom posts feed (AuthorBrief from cached
    objects) — a rename must not linger as the old name in lists/feeds for the
    cache TTL (ISS-607/TASK-529).
    """
    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise AppException(ErrorCode.NOT_FOUND, "User not found", status_code=404)
    if "display_name" in updates:
        user.display_name = updates["display_name"]
    if "bio" in updates:
        user.bio = updates["bio"]
    await db.commit()
    await db.refresh(user)
    clear_posts_list_cache()
    return user


async def delete_user(db: AsyncSession, current_user_id: int, user_id: int) -> None:
    """Delete an admin user account (superuser only), purging dependent rows."""
    if user_id == current_user_id:
        raise ValueError("Cannot delete yourself")

    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise AppException(ErrorCode.NOT_FOUND, "User not found", status_code=404)

    # AuthorFollow is an additive DEC-009 table with no ORM cascade from User:
    # purge the writer-follow rows too, or a deleted author leaves stale
    # follows that, on SQLite autoincrement id reuse, re-point at an unrelated
    # later user (same orphan class as category/tag/series follows — deep-dive
    # finding).
    await db.execute(delete(models.AuthorFollow).where(models.AuthorFollow.author_id == user_id))
    await db.delete(user)
    await db.commit()


async def list_users(db: AsyncSession) -> Sequence[models.User]:
    """All admin user accounts (superuser surface)."""
    return (await db.execute(select(auth.User))).scalars().all()


async def change_password(
    db: AsyncSession,
    current_user: auth.User,
    current_password: str,
    new_password: str,
) -> dict:
    """Change the current admin's password.

    Invalidates every previously-issued JWT for this admin: bumps the token
    version checked in get_current_user. (RIL round 16 security audit)
    """
    if not auth.verify_password(current_password, current_user.password):
        raise ValueError("Current password is incorrect")
    current_user.password = auth.get_password_hash(new_password)
    current_user.token_version = (current_user.token_version or 0) + 1
    await db.commit()
    return {"message": "Password updated"}


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


async def upload_user_avatar(
    db: AsyncSession,
    user_id: int,
    content: bytes,
    content_type: str | None,
) -> models.User:
    """Set an admin user's public profile picture (superuser, round 358).

    Same defense-in-depth validation as the reader avatar (content-type
    whitelist, size cap, magic bytes, full Pillow decode, never-larger
    re-encode that strips EXIF) via the shared app.image_validation. The new
    avatar is written to static/avatars first, then the DB row is updated and
    any previous avatar file removed, so a failed write never leaves a dangling
    URL. The login username is never exposed by any of this — avatar_url is a
    public /static URL only.
    """
    if content_type not in ALLOWED_TYPES:
        raise ValueError("Unsupported file type")
    if len(content) > MAX_SIZE:
        raise ValueError("File too large (max 5MB)")
    if not has_matching_magic_bytes(content, content_type):
        raise ValueError("File content does not match the declared image type")
    try:
        verify_image_decodes(content)
    except UnidentifiedImageError, OSError, ValueError:
        raise ValueError("File is not a valid image")

    contents = optimize_image(content, content_type)

    # Resolve the target user BEFORE writing anything to disk so an unknown id
    # 404s without orphaning a file in static/avatars.
    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise AppException(ErrorCode.NOT_FOUND, "User not found", status_code=404)

    ext = ALLOWED_TYPES_MAP.get(content_type, "jpg")
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


async def remove_user_avatar(db: AsyncSession, user_id: int) -> models.User:
    """Remove an admin user's public profile picture (stored file + DB row)."""
    user = (await db.execute(select(auth.User).where(auth.User.id == user_id))).scalar_one_or_none()
    if not user:
        raise AppException(ErrorCode.NOT_FOUND, "User not found", status_code=404)
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


# ---------------------------------------------------------------------------
# Category / tag taxonomy CRUD (admin surface)
# ---------------------------------------------------------------------------


async def create_category(db: AsyncSession, name: str) -> dict:
    """Create a category, 400 when the name already exists."""
    existing = (await db.execute(select(models.Category).where(models.Category.name == name))).scalar_one_or_none()
    if existing:
        raise ValueError("Category already exists")

    category = models.Category(name=name)
    db.add(category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Category already exists")
    await db.refresh(category)
    clear_categories_cache()
    return {"id": category.id, "name": category.name}


async def update_category(db: AsyncSession, category_id: int, name: str) -> dict:
    """Rename a category, 404 when missing, 400 on a duplicate name."""
    category = (await db.execute(select(models.Category).where(models.Category.id == category_id))).scalar_one_or_none()
    if not category:
        raise AppException(ErrorCode.CATEGORY_NOT_FOUND, "Category not found", status_code=404)

    category.name = name
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Category already exists")
    clear_categories_cache()
    # Renamed name is embedded in cached public post lists and feeds (ISS-057).
    clear_posts_list_cache()
    return {"id": category.id, "name": category.name}


async def delete_category(db: AsyncSession, category_id: int) -> None:
    """Delete a category, 404 when missing, 400 while posts reference it."""
    category = (await db.execute(select(models.Category).where(models.Category.id == category_id))).scalar_one_or_none()
    if not category:
        raise AppException(ErrorCode.CATEGORY_NOT_FOUND, "Category not found", status_code=404)

    # Check for posts referencing this category
    post_count = (
        await db.execute(select(func.count()).select_from(models.Post).where(models.Post.category_id == category_id))
    ).scalar() or 0
    if post_count > 0:
        raise ValueError(f"Cannot delete category: {post_count} post(s) reference it")

    await db.delete(category)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete category: it is referenced by posts")
    clear_categories_cache()


async def create_tag(db: AsyncSession, name: str) -> dict:
    """Create a tag, 400 when the name already exists."""
    existing = (await db.execute(select(models.Tag).where(models.Tag.name == name))).scalar_one_or_none()
    if existing:
        raise ValueError("Tag already exists")

    tag = models.Tag(name=name)
    db.add(tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Tag already exists")
    await db.refresh(tag)
    clear_tags_cache()
    return {"id": tag.id, "name": tag.name}


async def update_tag(db: AsyncSession, tag_id: int, name: str) -> dict:
    """Rename a tag, 404 when missing, 400 on a duplicate name."""
    tag = (await db.execute(select(models.Tag).where(models.Tag.id == tag_id))).scalar_one_or_none()
    if not tag:
        raise AppException(ErrorCode.TAG_NOT_FOUND, "Tag not found", status_code=404)

    tag.name = name
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Tag already exists")
    clear_tags_cache()
    # Renamed name is embedded in cached public post lists and feeds (ISS-057).
    clear_posts_list_cache()
    return {"id": tag.id, "name": tag.name}


async def delete_tag(db: AsyncSession, tag_id: int) -> None:
    """Delete a tag, 404 when missing, 400 while posts reference it."""
    tag = (await db.execute(select(models.Tag).where(models.Tag.id == tag_id))).scalar_one_or_none()
    if not tag:
        raise AppException(ErrorCode.TAG_NOT_FOUND, "Tag not found", status_code=404)

    # Check for posts referencing this tag
    post_count = (
        await db.execute(select(func.count()).select_from(models.Post).where(models.Post.tags.any(id=tag_id)))
    ).scalar() or 0
    if post_count > 0:
        raise ValueError(f"Cannot delete tag: {post_count} post(s) reference it")

    await db.delete(tag)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete tag: it is referenced by posts")
    clear_tags_cache()


# ---------------------------------------------------------------------------
# Admin post / reader listings
# ---------------------------------------------------------------------------


async def list_posts(
    db: AsyncSession,
    skip: int,
    limit: int,
    q: str | None,
    status: str | None,
) -> dict:
    """Paginated admin post list across all statuses, with per-post page
    comment counts — mirrors the public get_posts list for the dashboard."""
    stmt = select(models.Post)

    if q:
        stmt = stmt.where(models.Post.title.ilike(f"%{escape_like_pattern(q)}%", escape="\\"))

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


async def list_readers(
    db: AsyncSession,
    page: int,
    limit: int,
    q: str | None,
) -> dict:
    """List registered reader accounts with moderation aggregates.

    Any admin role (superuser or editor) may view readers — this is a
    moderation responsibility like the comment queue, not the superuser-only
    admin-users provisioning surface. Returns raw item dicts matching the
    AdminReaderSummary response model.
    """
    stmt = select(auth.ReaderAccount)
    if q:
        like = f"%{escape_like_pattern(q)}%"
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
        {
            "id": r.id,
            "email": r.email,
            "display_name": r.display_name,
            "is_active": bool(r.is_active),
            "created_at": r.created_at,
            "last_login_at": r.last_login_at,
            "comment_count": comment_counts.get(r.id, 0),
            "bookmark_count": bookmark_counts.get(r.id, 0),
        }
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


# ---------------------------------------------------------------------------
# Editorial calendar grid (DEC-162, TASK-194)
# ---------------------------------------------------------------------------


async def calendar_posts(db: AsyncSession, month: str) -> dict:
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
    from datetime import datetime, timedelta

    try:
        month_start = datetime.strptime(f"{month}-01", "%Y-%m-%d")
    except ValueError:
        raise ValueError("Invalid month; use YYYY-MM")
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


# ---------------------------------------------------------------------------
# Reader account moderation (DEC-194, TASK-214, ISS-116)
# ---------------------------------------------------------------------------


async def get_reader_or_404(db: AsyncSession, reader_id: int) -> auth.ReaderAccount:
    """Fetch a reader account or 404. Used by the moderation routes."""
    reader = await db.get(auth.ReaderAccount, reader_id)
    if reader is None:
        raise AppException(ErrorCode.NOT_FOUND, "Reader not found", status_code=404)
    return reader


async def deactivate_reader(db: AsyncSession, reader_id: int) -> models.ReaderAccount:
    """Deactivate a reader account (admin only).

    Sets is_active=False and bumps token_version so every previously issued
    JWT dies immediately; the account can no longer sign in. Old tokens are
    rejected by get_current_reader and resolve to anonymous in optional-reader
    endpoints, so the trust-tier auto-approve path (DEC-098) cannot be gamed
    through a deactivated account. Idempotent: an already-inactive reader is
    not re-bumped.
    """
    reader = await get_reader_or_404(db, reader_id)
    if reader.is_active:
        reader.is_active = False
        reader.token_version = (reader.token_version or 0) + 1
        await db.commit()
    return reader


async def activate_reader(db: AsyncSession, reader_id: int) -> models.ReaderAccount:
    """Reactivate a deactivated reader account (admin only).

    The account can sign in again; token_version stays bumped from the
    deactivation, so the reader must obtain a fresh token (old ones remain
    revoked).
    """
    reader = await get_reader_or_404(db, reader_id)
    if not reader.is_active:
        reader.is_active = True
        await db.commit()
    return reader
