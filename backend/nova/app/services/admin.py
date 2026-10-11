"""
Admin service: admin post lifecycle (create/clone/update/revisions) with the new-post notification + newsletter/push fan-out, and comment moderation orchestration.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import auth, models
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

__all__ = [
    "batch_approve_comments",
    "boolean_setting",
    "bulk_delete_comments",
    "clone_post",
    "create_post",
    "delete_comment",
    "delete_post",
    "dismiss_comment_flags",
    "escape_like_pattern",
    "get_category",
    "get_post_revision",
    "get_post_revisions",
    "list_comments",
    "notify_post_published",
    "reply_comment",
    "restore_post_revision",
    "update_post",
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
