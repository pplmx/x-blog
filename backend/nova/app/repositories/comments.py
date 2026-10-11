"""Comment CRUD, moderation, flags, and likes."""

from __future__ import annotations

import secrets
from typing import Any, cast

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import auth, models, schemas
from app.cache import (
    clear_posts_list_cache,
)

from ._base import escape_like_pattern, utc_now_naive


async def get_comments_paginated(
    db: AsyncSession,
    post_id: int,
    page: int = 1,
    limit: int = 20,
    sort: str = "newest",
    q: str = "",
) -> tuple[list[models.Comment], int]:
    """Get paginated approved comments for a post.

    ``sort`` is one of ``newest`` (default, created_at desc), ``oldest``
    (created_at asc) or ``likes`` (likes desc, created_at desc tiebreak).
    The caller is responsible for whitelisting the value before this runs;
    anything else falls back to the default newest order (DEC-094, TASK-159).

    ``q`` narrows the thread to approved comments whose content contains every
    whitespace-separated term (case-insensitive substring, DEC-442/TASK-452) —
    the "search inside this thread" surface. LIKE metacharacters are escaped so
    a ``%`` query matches literally (search_comments/search_posts parity); an
    empty/whitespace q is a no-op (full thread). The caller owns length limits.

    Returns:
        Tuple of (comments list, total count)
    """
    query = select(models.Comment).where(
        models.Comment.post_id == post_id,
        models.Comment.is_approved == True,  # noqa: E712
    )

    q_terms = [t for t in q.strip().split() if t]
    if q_terms:
        # Substring AND across terms, mirroring search_comments / the CJK-safe
        # search_posts path (DEC-084) so Chinese terms match partial runs too.
        query = query.where(
            *[models.Comment.content.ilike(f"%{escape_like_pattern(t)}%", escape="\\") for t in q_terms]
        )

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    # Every sort appends id as a deterministic tiebreak: offset paging would
    # otherwise repeat/skip rows when two comments share a created_at (e.g. a
    # bulk-restore stamps verbatim timestamps), resolving ties by query plan
    # instead of a stable key (round 278).
    if sort == "oldest":
        order = [models.Comment.created_at.asc(), models.Comment.id.asc()]
    elif sort == "likes":
        # Most helpful first; newest wins ties among equal like counts, then id.
        order = [models.Comment.likes.desc(), models.Comment.created_at.desc(), models.Comment.id.desc()]
    else:
        order = [models.Comment.created_at.desc(), models.Comment.id.desc()]
    # Eager-load the author reader on the page query so serializing
    # CommentPublic (which touches c.reader) doesn't fire one lazy query per
    # reader-attributed comment (ISS-139).
    comments = list(
        (
            await db.execute(
                query.options(joinedload(models.Comment.reader))
                .order_by(*order)
                .offset((page - 1) * limit)
                .limit(limit)
            )
        ).scalars()
    )

    return comments, total


async def create_comment(
    db: AsyncSession,
    post_id: int,
    comment: schemas.CommentCreate,
    ip_address: str,
    reader: auth.ReaderAccount | None = None,
) -> models.Comment:
    # Validate that the post exists
    post = await db.get(models.Post, post_id)
    if not post:
        raise ValueError(f"Post with id {post_id} not found")

    # Validate parent comment (for threaded replies)
    if comment.parent_id is not None:
        parent = await db.get(models.Comment, comment.parent_id)
        if not parent:
            raise ValueError(f"Parent comment with id {comment.parent_id} not found")
        if parent.post_id != post_id:
            raise ValueError("Parent comment does not belong to this post")
        # Only approved parents are publicly visible; blocking replies to
        # pending/rejected comments prevents an approved reply from being
        # orphaned under a parent a moderator later rejects.
        if not parent.is_approved:
            raise ValueError("Cannot reply to a comment awaiting approval")

    # Reader-attributed comments (DEC-062): when a signed-in reader authors the
    # comment, their identity is stamped from the account — client-supplied
    # nickname/email are IGNORED (a reader cannot spoof another's display name
    # or attach a bogus email). Using the account's email would stash PII in the
    # comment row; we store the reader_id only and keep the account email on
    # reader_accounts. Anonymous comments keep their free-text nickname/email.
    if reader is not None:
        # The public nickname for a verified reader is their display_name;
        # a reader who never set one gets a deterministic non-PII handle
        # instead of their account email (ISS-606/TASK-532) — the email was
        # the old fallback, which published the address on every comment
        # surface (thread, feeds, comment search, RSS/Atom) for readers who
        # registered with only {email, password}. `reader-{id}` is stable per
        # account (threads group by it) without being identity data.
        comment_nickname = reader.display_name or f"reader-{reader.id}"
        comment_email: str | None = None
        reader_id: int | None = reader.id
    else:
        comment_nickname = comment.nickname
        comment_email = comment.email
        reader_id = None

    # Guest reply-email consent (DEC-332): honored ONLY for anonymous comments
    # AND only when there is an address to deliver to (a consent with no email
    # is stored as off — nothing to send, no token). A signed-in reader's
    # reply email is the account-level per-kind pref (DEC-197), never this
    # comment-row consent, so their value is discarded here.
    reply_notify_email = bool(reader_id is None and comment.reply_notify_email and comment_email)
    db_comment = models.Comment(
        post_id=post_id,
        parent_id=comment.parent_id,
        nickname=comment_nickname,
        email=comment_email,
        content=comment.content,
        ip_address=ip_address,
        reader_id=reader_id,
        reply_notify_email=reply_notify_email,
        # The unsubscribe token lives only while consent is on: it is emailed to
        # the guest, so a comment that never consented has no token to send.
        reply_notify_token=(secrets.token_urlsafe(32) if reply_notify_email else None),
        # Moderation: comments are never auto-approved; an admin must approve
        # them via the approve/batch-approve endpoints. The client's value is
        # ignored (CommentCreate no longer accepts is_approved).
        is_approved=False,
    )
    db.add(db_comment)
    try:
        await db.commit()
        await db.refresh(db_comment)
    except IntegrityError:
        await db.rollback()
        raise ValueError("Failed to create comment")
    # Re-load the author reader eagerly for response serialization (Comment
    # schema reads comment.reader) — async: post-commit lazy access raises
    # MissingGreenlet (RIL async migration).
    db_comment = (
        await db.execute(
            select(models.Comment).options(joinedload(models.Comment.reader)).where(models.Comment.id == db_comment.id)
        )
    ).scalars().first() or db_comment
    # The public posts list serializes approved comment_count per post; a new
    # (or subsequently approved) comment changes those counts, so invalidate
    # the cached list rather than wait up to 300s TTL (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return db_comment


async def get_guest_comment_by_token(db: AsyncSession, token: str) -> models.Comment | None:
    """Fetch an ANONYMOUS comment by its per-comment management token (DEC-332).

    ``reply_notify_token`` is the secret only the guest's approval/reply email
    carries, so possession proves the guest (or an address they control) holds
    the mail — the same ownership argument the unsubscribe endpoint uses. Only
    consenting anonymous comments ever have a token; a reader-attributed
    comment or a token-less guest comment can never match. Unknown token → None
    (indistinguishable 404, ids are not enumerable). (round 385, DEC-435/
    TASK-444)
    """

    if not token:
        return None
    return (
        (await db.execute(select(models.Comment).where(models.Comment.reply_notify_token == token))).scalars().first()
    )


async def update_guest_comment(db: AsyncSession, token: str, content: str) -> tuple[models.Comment | None, bool]:
    """Edit an ANONYMOUS comment proven by its management token (round 385).

    Mirror of ``update_reader_comment`` (DEC-096) keyed by the token instead of
    ``reader_id``: only ``content`` may change (post_id/parent_id/identity are
    preserved), the body is stored raw and re-rendered through the sanitized
    markdown pipeline, and ``edited_at`` is stamped. ``was_public`` reports
    whether the comment was approved BEFORE the edit so the caller never
    re-notifies subscribers of a comment that stayed public through the edit.

    Moderation integrity, same rule as the reader path (and stricter for a
    guest — there is no verified-reader trust tier to fast-path): an approved
    comment that is edited has REPLACED its public content, so it re-enters the
    moderation queue (approval reset, reviewed_at cleared) rather than silently
    republishing author-supplied text over a moderator-approved body.
    """

    comment = await get_guest_comment_by_token(db, token)
    if comment is None:
        return None, False
    was_public = bool(comment.is_approved)
    comment.content = content
    comment.edited_at = utc_now_naive()
    comment.is_approved = False
    comment.reviewed_at = None
    await db.commit()
    await db.refresh(comment)
    return comment, was_public


async def delete_guest_comment(db: AsyncSession, token: str) -> bool:
    """Delete an ANONYMOUS comment proven by its management token (round 385).

    Mirror of ``delete_reader_comment`` (DEC-096): False when the token matches
    no comment; replies are reparented to this comment's parent (or promoted to
    top-level) rather than blocking the delete, so a guest can withdraw a
    comment that already has replies without orphaning the thread. Deeper
    descendants ride along under the promoted reply.
    """

    comment = await get_guest_comment_by_token(db, token)
    if comment is None:
        return False
    target_parent = comment.parent_id
    await db.execute(
        update(models.Comment)
        .where(models.Comment.parent_id == comment.id)
        .values({models.Comment.parent_id: target_parent})
    )
    await db.delete(comment)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete comment: it has dependent records")
    # Removing an approved comment changes the approved comment_count surfaced
    # on the cached public posts list (same as reader/admin delete).
    clear_posts_list_cache()
    return True


async def approve_comment(db: AsyncSession, comment_id: int, approved: bool = True) -> models.Comment | None:
    """Approve or reject a comment. Idempotent: applying the state the comment
    already has is a no-op (no reviewed_at bump, no cache clear), so a re-approve
    click / batch re-run cannot churn state — routers that fan out notifications
    gate on the transition themselves (round-296 deep-dive; the reader-edit path
    already guards via ``was_public``, ISS-404)."""
    comment = (
        (
            await db.execute(
                select(models.Comment).options(joinedload(models.Comment.reader)).where(models.Comment.id == comment_id)
            )
        )
        .scalars()
        .first()
    )
    if not comment:
        return None
    # Already in the requested reviewed state: no-op. reviewed_at must be set
    # too — a pending comment is is_approved=False with reviewed_at NULL, so a
    # REJECT of a pending comment still has to stamp it (moving it out of the
    # moderation queue), even though is_approved is already False.
    if comment.is_approved == approved and comment.reviewed_at is not None:
        return comment
    comment.is_approved = approved
    # Reviewed_at distinguishes "still pending" from "reviewed and rejected" for
    # the author's comment history (DEC-066, TASK-139). Set on both outcomes.
    # Naive UTC (ISS-452): reviewed_at is a naive-UTC DateTime column; an aware
    # write is a latent trap if the row is ever cached/serialized pre-flight.
    comment.reviewed_at = utc_now_naive()
    await db.commit()
    # Async: db.refresh() expires the joinedloaded `reader` relationship, so a
    # subsequent response-serialization of comment.reader would lazy-load →
    # MissingGreenlet. Reload the whole row with the reader eagerly loaded.
    comment = (
        (
            await db.execute(
                select(models.Comment).options(joinedload(models.Comment.reader)).where(models.Comment.id == comment.id)
            )
        )
        .scalars()
        .first()
    )
    # Approving (or rejecting) a comment changes the approved comment_count
    # surfaced on the cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return comment


async def delete_reader_comment(db: AsyncSession, comment_id: int, reader_id: int) -> bool:
    """Delete one of the reader's own comments (any status). False if the
    comment is missing or belongs to a different reader. (DEC-066, TASK-139)

    Replies are reparented to this comment's parent (or promoted to top-level
    when it had none) rather than blocking the delete, so a reader can withdraw
    a comment that already has replies without orphaning the thread (DEC-096,
    TASK-160). Deeper descendants ride along under the promoted reply.
    """
    comment = (
        (
            await db.execute(
                select(models.Comment).where(models.Comment.id == comment_id, models.Comment.reader_id == reader_id)
            )
        )
        .scalars()
        .first()
    )
    if not comment:
        return False
    # Promote direct replies to the deleted comment's parent (or to top-level).
    # SQLAlchemy's bulk update avoids loading each reply; synchronize_session
    # is disabled because we only need the DB state.
    target_parent = comment.parent_id
    await db.execute(
        update(models.Comment)
        .where(models.Comment.parent_id == comment_id)
        .values({models.Comment.parent_id: target_parent})
    )
    await db.delete(comment)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete comment: it has dependent records")
    # Same as admin delete: removing an approved comment changes the approved
    # comment_count on the cached public posts list.
    clear_posts_list_cache()
    return True


async def update_reader_comment(
    db: AsyncSession, comment_id: int, reader_id: int, content: str
) -> tuple[models.Comment | None, bool]:
    """Edit one of the reader's own comments (any status).

    Returns ``(comment, was_public)`` — the updated comment (or None if it is
    missing or belongs to a different reader, indistinguishable 404) and whether
    the comment was publicly visible (approved) BEFORE the edit. ``was_public``
    tells the caller whether this edit took the comment off the public surface;
    if it was already public, an auto-approve republish must not re-notify its
    subscribers (RIL ISS-404). Content is stored raw and re-rendered through the
    same sanitized markdown pipeline as a new comment, so an edit can never
    weaken the XSS guarantees (DEC-096, TASK-160). The ``edited_at`` marker is
    stamped so the UI can surface it.

    Moderation integrity (security review): an edit REPLACES the comment's
    public content, so an approved comment must not silently republish the new
    text — the reader could swap in spam/phishing after an admin approved the
    original. Reset approval so the edited version re-enters the same
    moderation policy as a new comment (the caller re-applies the verified-
    reader trust tier if enabled, exactly like create). Pending/rejected
    comments were already not public, so resetting them is a no-op in practice.
    """
    comment = (
        (
            await db.execute(
                select(models.Comment).where(models.Comment.id == comment_id, models.Comment.reader_id == reader_id)
            )
        )
        .scalars()
        .first()
    )
    if not comment:
        return None, False
    # is_approved is nullable; NULL is not public, so coerce for the bool contract.
    was_public = bool(comment.is_approved)
    comment.content = content
    # Naive UTC, like reviewed_at (ISS-452).
    comment.edited_at = utc_now_naive()
    comment.is_approved = False
    comment.reviewed_at = None
    await db.commit()
    await db.refresh(comment)
    # The public posts list / feeds serialize approved comment_count; an edit
    # that resets an approved comment (comment drops off the public surface,
    # count falls) must invalidate the cached list immediately — create and
    # approve already clear, edit was the gap (ISS-608/TASK-529). The caller
    # re-applies the verified-reader auto-approve tier after this returns; if
    # it re-approves, the following approve_comment clears again (harmless
    # double-clear, keeps the invariant "writes invalidate explicitly").
    clear_posts_list_cache()
    return comment, was_public


async def get_pending_comments(db: AsyncSession) -> list[models.Comment]:
    """Get all pending (unapproved) comments."""
    return list(
        (
            await db.execute(
                select(models.Comment)
                .where(models.Comment.is_approved == False)  # noqa: E712
                .order_by(models.Comment.created_at.desc())
            )
        ).scalars()
    )


async def get_all_comments(db: AsyncSession) -> list[models.Comment]:
    """Get all comments for admin review."""
    return list((await db.execute(select(models.Comment).order_by(models.Comment.created_at.desc()))).scalars())


async def bulk_delete_comments(db: AsyncSession, ids: list[int]) -> int:
    """Delete many comments at once, keeping the thread consistent (DEC-110).

    Surviving direct replies of a deleted comment are promoted to the nearest
    surviving ancestor (or top-level) — walking up past any ancestors that are
    themselves being deleted — so a bulk delete never orphans a thread or
    leaves a reply pointing at a deleted parent. Returns the number deleted.
    """
    delete_set = set(ids)
    comments = list((await db.execute(select(models.Comment).where(models.Comment.id.in_(delete_set)))).scalars())
    if not comments:
        return 0
    existing_ids = {c.id for c in comments}
    # ISS-557 (performance deep-dive): the old loop issued one reply-query per
    # comment (up to the batch cap of 100) plus one db.get per ancestor while
    # walking the parent chain. Both collapse to one query + an in-memory map:
    #  - the ancestor walk only ever follows ids INSIDE the delete set (it
    #    stops at the first surviving ancestor), so the parent ids of the
    #    rows we already loaded are the whole walk table;
    #  - all surviving direct replies of any deleted comment come from one
    #    parent_id IN (...) query.
    parent_of = {c.id: c.parent_id for c in comments}
    child_rows = (
        await db.execute(
            select(models.Comment.id, models.Comment.parent_id).where(
                models.Comment.parent_id.in_(existing_ids),
                models.Comment.id.notin_(existing_ids),
            )
        )
    ).all()
    children_by_parent: dict[int, list[int]] = {}
    for cid, pid in child_rows:
        children_by_parent.setdefault(pid, []).append(cid)
    for c in comments:
        survivor_ids = children_by_parent.get(c.id, [])
        if not survivor_ids:
            continue
        # Nearest ancestor of c that is not itself being deleted.
        eff_parent = c.parent_id
        seen: set[int] = set()
        while eff_parent is not None and eff_parent in existing_ids and eff_parent not in seen:
            seen.add(eff_parent)
            eff_parent = parent_of.get(eff_parent)
        await db.execute(
            update(models.Comment)
            .where(models.Comment.id.in_(survivor_ids))
            .values({models.Comment.parent_id: eff_parent})
        )
    # Bulk deletes (ISS-557): the previous per-row `db.delete(c)` walked the
    # self-referential `replies` backref one query per comment (a batch of 100
    # = 100 extra SELECTs). comment_likes/comment_flags are additive tables
    # with no DB-level FK (DEC-009), so their rows are reaped explicitly, then
    # the comment set is removed with a single DELETE. The reparent above
    # guarantees no surviving row references a deleted id, so the self-join
    # FK cannot be violated even on PostgreSQL.
    await db.execute(delete(models.CommentFlag).where(models.CommentFlag.comment_id.in_(existing_ids)))
    await db.execute(delete(models.CommentLike).where(models.CommentLike.comment_id.in_(existing_ids)))
    await db.execute(delete(models.Comment).where(models.Comment.id.in_(existing_ids)))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete comments: dependent records remain")
    # Deleting approved comments changes the approved comment_count on the
    # cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return len(comments)


async def delete_comment(db: AsyncSession, comment_id: int) -> bool:
    comment = (await db.execute(select(models.Comment).where(models.Comment.id == comment_id))).scalars().first()
    if not comment:
        return False
    await db.delete(comment)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete comment: it has dependent records")
    # Deleting an approved comment changes the approved comment_count surfaced
    # on the cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return True


async def delete_comment_reparent(db: AsyncSession, comment_id: int) -> bool:
    """Delete one comment, promoting its surviving direct replies to the
    nearest surviving ancestor (or top-level), so a single admin delete never
    orphans a thread or leaves a reply pointing at a deleted parent.

    Mirrors the reparenting in ``bulk_delete_comments`` (DEC-110) — the plain
    ``delete_comment`` refuses (400) on Postgres when replies exist and silently
    orphans them on SQLite, which left admins unable to remove a spam thread.
    Returns False when the comment does not exist.
    """
    comment = (await db.execute(select(models.Comment).where(models.Comment.id == comment_id))).scalars().first()
    if not comment:
        return False
    has_replies = (
        await db.execute(select(models.Comment.id).where(models.Comment.parent_id == comment_id))
    ).first() is not None
    if has_replies:
        # Nearest surviving ancestor of the deleted comment: its own parent,
        # which by definition is not in the deletion set (only this one comment
        # is being removed) — single-comment analogue of bulk_delete_comments.
        eff_parent = comment.parent_id
        await db.execute(
            update(models.Comment)
            .where(models.Comment.parent_id == comment_id)
            .values({models.Comment.parent_id: eff_parent})
        )
    await db.delete(comment)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete comment: dependent records remain")
    # Deleting an approved comment changes the approved comment_count surfaced
    # on the cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return True


async def flag_comment(db: AsyncSession, comment_id: int, ip_key: str, reason: str | None = None) -> tuple[bool, int]:
    """Record a reader flag on a comment; idempotent per (comment, ip_key).

    Returns (created_new, total_distinct_flags). A second flag from the same
    source key is a no-op (unique constraint) so the moderator sees distinct
    reporters, not click spam (DEC-108, TASK-166).
    """
    existing = (
        (
            await db.execute(
                select(models.CommentFlag).where(
                    models.CommentFlag.comment_id == comment_id, models.CommentFlag.ip_key == ip_key
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is None:
        db.add(models.CommentFlag(comment_id=comment_id, ip_key=ip_key, reason=reason))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()  # concurrent duplicate → treat as idempotent no-op
    total = (
        await db.execute(
            select(func.count()).select_from(
                select(models.CommentFlag).where(models.CommentFlag.comment_id == comment_id).subquery()
            )
        )
    ).scalar() or 0
    return existing is None, total


async def flag_counts_for_comments(db: AsyncSession, comment_ids: list[int]) -> dict[int, int]:
    """Map comment_id -> distinct-flag count for the admin comment list."""
    if not comment_ids:
        return {}
    rows = (
        await db.execute(
            select(models.CommentFlag.comment_id, func.count(models.CommentFlag.id))
            .where(models.CommentFlag.comment_id.in_(comment_ids))
            .group_by(models.CommentFlag.comment_id)
        )
    ).all()
    counts: dict[int, int] = {}
    for cid, count in rows:
        counts[int(cid)] = int(count)
    return counts


async def dismiss_comment_flags(db: AsyncSession, comment_id: int) -> int:
    """Clear all flags on a comment (moderator dismissed the reports)."""
    removed = cast(
        CursorResult[Any],
        await db.execute(delete(models.CommentFlag).where(models.CommentFlag.comment_id == comment_id)),
    ).rowcount
    await db.commit()
    return removed


async def increment_comment_likes(db: AsyncSession, comment_id: int, commit: bool = True) -> models.Comment | None:
    """Increment the like count for a comment using atomic SQL update.

    ``commit=False`` keeps the bump inside the caller's transaction (like_comment
    persists the CommentLike row and the counter in ONE commit, ISS-560).
    """
    stmt = update(models.Comment).where(models.Comment.id == comment_id).values(likes=models.Comment.likes + 1)
    await db.execute(stmt)
    try:
        await db.flush() if not commit else await db.commit()
    except Exception:
        await db.rollback()
        raise
    comment = await db.get(models.Comment, comment_id)
    if comment:
        await db.refresh(comment)
    return comment


async def like_comment(db: AsyncSession, comment_id: int, ip_key: str) -> tuple[bool, models.Comment | None]:
    """Register a like from one source; idempotent per (comment, ip_key).

    Returns (is_new, updated_comment). Mirrors flag_comment's dedupe (security
    review): the unique pair means a second like from the same source is a
    no-op, so the count reflects distinct supporters instead of a client-guarded
    count++ an attacker could inflate to skew the "most helpful" ordering.
    """
    existing = (
        (
            await db.execute(
                select(models.CommentLike).where(
                    models.CommentLike.comment_id == comment_id, models.CommentLike.ip_key == ip_key
                )
            )
        )
        .scalars()
        .first()
    )
    is_new = existing is None
    if is_new:
        db.add(models.CommentLike(comment_id=comment_id, ip_key=ip_key))
        # ISS-560: row + counter in ONE transaction. The old code committed
        # the CommentLike insert and the atomic counter bump separately; a
        # failure between them left a committed like row with no count and no
        # re-sync path (comments can only be liked, never re-counted). A
        # concurrent duplicate (IntegrityError at flush) stays an idempotent
        # no-op; any other failure rolls the whole like back.
        try:
            await increment_comment_likes(db, comment_id, commit=False)
            await db.commit()
        except IntegrityError:
            await db.rollback()  # concurrent duplicate → treat as idempotent no-op
            is_new = False
        except Exception:
            await db.rollback()
            raise
    comment = await db.get(models.Comment, comment_id)
    if comment:
        await db.refresh(comment)
    return is_new, comment


async def get_reader_comments(
    db: AsyncSession,
    reader_id: int,
    status: str = "all",
    page: int = 1,
    limit: int = 20,
    q: str | None = None,
) -> tuple[list[models.Comment], int]:
    """A reader's own comments, newest first, with status filter + pagination.

    DEC-066/TASK-139 showed pending/rejected comments to their author (with a
    derived status); DEC-102/TASK-163 adds a status filter (all|pending|
    approved|rejected) and pagination so a reader with a long history can find
    pending/rejected items and page through. ``q`` (optional) filters to the
    reader's own comments whose content matches the term (case-insensitive,
    escape-aware — DEC-411/TASK-431) so a reader can recall a specific comment;
    it composes with the status filter. Public read paths still filter to
    approved only.

    Returns:
        Tuple of (page of comments, total count matching the filter).
    """
    query = select(models.Comment).where(models.Comment.reader_id == reader_id)
    if status == "approved":
        query = query.where(models.Comment.is_approved == True)  # noqa: E712
    elif status == "rejected":
        query = query.where(
            models.Comment.is_approved == False,  # noqa: E712
            models.Comment.reviewed_at.isnot(None),
        )
    elif status == "pending":
        query = query.where(
            models.Comment.is_approved == False,  # noqa: E712
            models.Comment.reviewed_at.is_(None),
        )
    # "all" -> no filter
    if q and q.strip():
        term = f"%{escape_like_pattern(q.strip())}%"
        query = query.where(models.Comment.content.ilike(term, escape="\\"))

    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    # joinedload(reader) — matching get_comments_paginated's ISS-139 fix: the
    # serialized CommentPublic.reader reads c.reader.id/display_name, so without
    # this each attributed comment costs one lazy query (N+1 on the reader's own
    # comment history list).
    items = list(
        (
            await db.execute(
                query.options(joinedload(models.Comment.reader))
                .order_by(models.Comment.created_at.desc(), models.Comment.id.desc())  # id tiebreak (round 278)
                .offset((page - 1) * limit)
                .limit(limit)
            )
        ).scalars()
    )
    return items, total


async def list_reader_public_comments(
    db: AsyncSession, reader_id: int, page: int = 1, limit: int = 20
) -> tuple[list[models.Comment], int]:
    """Approved comments a reader has left on *publicly-visible* posts.

    The profile page (DEC-294/TASK-376) shows a commenter's contribution; it
    must not leak semi-private rows the same way the private /me/comments path
    (which includes pending/rejected for the author) or drafts do. So the scope
    is: is_approved AND the commented post is publicly visible (published,
    publish_at passed) — mirroring get_comments_paginated's approval gate plus
    the is_publicly_visible post gate. Newest first with id tiebreak (shared
    with get_reader_comments).
    """
    now = utc_now_naive()
    query = (
        select(models.Comment)
        .join(models.Post, models.Comment.post_id == models.Post.id)
        .where(
            models.Comment.reader_id == reader_id,
            models.Comment.is_approved == True,  # noqa: E712
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    items = list(
        (
            await db.execute(
                query.options(joinedload(models.Comment.reader), joinedload(models.Comment.post))
                .order_by(models.Comment.created_at.desc(), models.Comment.id.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        ).scalars()
    )
    return items, total


async def list_public_comment_feed(
    db: AsyncSession,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[models.Comment], int]:
    """Site-wide discussion feed (round 367, DEC-407).

    Newest approved comments on *publicly-visible* posts — the blog's
    conversation as a browsable stream, not just a search target (comment
    search, DEC-405). Same visibility gate as list_reader_public_comments /
    search_comments: is_approved AND the commented post is published with its
    publish_at passed (drafts/scheduled posts never leak their discussion);
    pending/rejected comments stay out; email/ip never ride the rows (serialized
    through CommentPublic at the router). Newest first with an id tiebreak.
    """
    now = utc_now_naive()
    query = (
        select(models.Comment)
        .join(models.Post, models.Comment.post_id == models.Post.id)
        .where(
            models.Comment.is_approved.is_(True),
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    items = list(
        (
            await db.execute(
                query.options(joinedload(models.Comment.reader), joinedload(models.Comment.post))
                .order_by(models.Comment.created_at.desc(), models.Comment.id.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        ).scalars()
    )
    return items, total


async def search_comments(
    db: AsyncSession,
    query: str,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[models.Comment], int]:
    """Public comment search (round 366, DEC-405).

    Approved comments on *publicly-visible* posts whose content matches every
    whitespace-separated term (substring AND — the dialect-agnostic path
    search_posts uses for CJK/mixed queries, DEC-084). Same public-visibility
    predicate as list_reader_public_comments: is_approved AND the commented
    post is published with its publish_at passed (a draft or scheduled post
    never leaks its discussion). Threads on comment-DISABLED posts stay public
    (the discussion remains visible), so they keep matching. Newest first with
    an id tiebreak (shared with the other comment listings). Never touches
    email/ip (PII).
    """
    now = utc_now_naive()
    if not query.strip():
        # Defense-in-depth: the router rejects blank q with 422, but this crud
        # call must never degrade into an ILIKE '% %' that matches every public
        # comment if a future caller forgets the boundary check.
        return [], 0
    # Whitespace-separated terms; run-on whitespace yields no empty terms.
    terms = [t for t in query.split() if t]
    query_where = (
        models.Comment.is_approved.is_(True),
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        # Escape LIKE metacharacters per term (search_posts precedent, DEC-084):
        # a reader searching "%" or "_" must find them literally, not match
        # every comment / treat _ as a single-char wildcard.
        *[models.Comment.content.ilike(f"%{escape_like_pattern(t)}%", escape="\\") for t in terms],
    )
    stmt = select(models.Comment).join(models.Post, models.Comment.post_id == models.Post.id).where(*query_where)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    items = list(
        (
            await db.execute(
                stmt.options(joinedload(models.Comment.reader), joinedload(models.Comment.post))
                .order_by(models.Comment.created_at.desc(), models.Comment.id.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            )
        ).scalars()
    )
    return items, total
