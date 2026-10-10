"""Comment-thread subscriptions (reader and guest)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import models

from ._base import _commit_reader_upsert, is_publicly_visible, utc_now_naive


async def get_comment_subscription(db: AsyncSession, reader_id: int, post_id: int) -> models.CommentSubscription | None:
    """Return the reader's thread subscription for a post, or None."""
    return (
        (
            await db.execute(
                select(models.CommentSubscription).where(
                    models.CommentSubscription.reader_id == reader_id,
                    models.CommentSubscription.post_id == post_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_comment_subscription(
    db: AsyncSession, reader_id: int, post_id: int
) -> tuple[models.CommentSubscription, bool]:
    """Follow a post's comment thread; returns (subscription, created).

    Idempotent: re-subscribing an existing follow returns the existing row
    with created=False (mirrors add_reader_bookmark's merge-friendly contract).
    """
    existing = await get_comment_subscription(db, reader_id, post_id)
    if existing:
        return existing, False
    subscription = models.CommentSubscription(reader_id=reader_id, post_id=post_id)
    db.add(subscription)
    if await _commit_reader_upsert(db):
        await db.refresh(subscription)
        return subscription, True
    existing = await get_comment_subscription(db, reader_id, post_id)
    if existing:
        return existing, False
    raise RuntimeError("thread subscription insert lost the unique-key race but no row was found")


async def remove_comment_subscription(db: AsyncSession, reader_id: int, post_id: int) -> bool:
    """Unfollow a post's comment thread; returns True if one was removed."""
    subscription = await get_comment_subscription(db, reader_id, post_id)
    if not subscription:
        return False
    await db.delete(subscription)
    await db.commit()
    return True


async def get_guest_comment_subscription(
    db: AsyncSession, email: str, post_id: int
) -> models.GuestCommentSubscription | None:
    """Return the guest thread-subscription row for an (email, post), or None."""
    return (
        (
            await db.execute(
                select(models.GuestCommentSubscription).where(
                    models.GuestCommentSubscription.email == email,
                    models.GuestCommentSubscription.post_id == post_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_guest_comment_subscription(
    db: AsyncSession, email: str, post_id: int, digest_weekly: bool = False
) -> tuple[models.GuestCommentSubscription, bool, bool]:
    """Record a guest's intent to follow a post's thread.

    Returns ``(row, created, needs_opt_in_email)``. Idempotent per (email,
    post): a pending/confirmed resubscribe returns the existing row with
    ``needs_opt_in_email=False`` and its confirm state unchanged — so a
    repeated subscribe never idempotently re-confirms and never mails twice.
    A DELIBERATELY UNSUBSCRIBED address (``unsubscribed_at`` set) starts a
    FRESH consent cycle (TASK-485/ISS-561, mirroring the newsletter round 393):
    token rotated, consent reset, ``needs_opt_in_email=True`` so the endpoint
    sends one new double-opt-in email and the old link can never re-activate.
    ``email`` is the caller's already-lowercased value; token is a fresh opaque
    secret (no-enumeration). ``digest_weekly`` (round 381, DEC-429) is the
    follower's cadence; a plain resubscribe never overrides the stored choice,
    but a re-activation re-records it like the newsletter does.
    """
    from secrets import token_urlsafe

    existing = await get_guest_comment_subscription(db, email, post_id)
    if existing:
        if existing.unsubscribed_at is not None:
            existing.is_confirmed = False
            existing.confirmed_at = None
            existing.unsubscribed_at = None
            existing.digest_weekly = digest_weekly
            existing.token = token_urlsafe(32)
            await db.commit()
            await db.refresh(existing)
            return existing, True, True
        return existing, False, False
    row = models.GuestCommentSubscription(
        email=email, post_id=post_id, token=token_urlsafe(32), digest_weekly=digest_weekly
    )
    db.add(row)
    if await _commit_reader_upsert(db):
        await db.refresh(row)
        return row, True, True
    existing = await get_guest_comment_subscription(db, email, post_id)
    if existing:
        return existing, False, False
    raise RuntimeError("guest thread subscription insert lost the unique-key race but no row was found")


async def get_guest_comment_subscription_by_token(
    db: AsyncSession, token: str
) -> models.GuestCommentSubscription | None:
    """The guest thread-subscription row owning ``token``, or None (no oracle)."""
    return (
        (
            await db.execute(
                select(models.GuestCommentSubscription).where(models.GuestCommentSubscription.token == token)
            )
        )
        .scalars()
        .first()
    )


async def confirm_guest_comment_subscription(db: AsyncSession, token: str) -> bool:
    """Flip a guest thread-subscription to confirmed via its token. Idempotent.

    Consent restart gate (TASK-485/ISS-561, mirroring the newsletter round 393):
    an address the holder explicitly unsubscribed must NOT be re-activated by
    replaying its ORIGINAL confirmation link — re-activation starts over via a
    fresh subscribe (fresh token + fresh double-opt-in email). The gate raises
    ValueError so the router answers 400 like the newsletter; an unknown token
    stays the no-oracle False (404).
    """
    row = await get_guest_comment_subscription_by_token(db, token)
    if row is None:
        return False
    if not row.is_confirmed:
        if row.unsubscribed_at is not None:
            raise ValueError("This address was unsubscribed. Please subscribe again to reactivate")
        row.is_confirmed = True
        row.confirmed_at = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()
    return True


async def unsubscribe_guest_comment_subscription(db: AsyncSession, token: str) -> bool:
    """Flip a guest thread-subscription's consent off via its token. Idempotent."""
    row = await get_guest_comment_subscription_by_token(db, token)
    if row is None:
        return False
    if row.is_confirmed:
        row.is_confirmed = False
        row.confirmed_at = None
        # Consent-restart marker (TASK-485/ISS-561): the holder cancelled it, so
        # a replayed confirm link must never flip this back on.
        row.unsubscribed_at = datetime.now(UTC).replace(tzinfo=None)
        await db.commit()
    return True


async def list_confirmed_guest_comment_subscribers(
    db: AsyncSession, post_id: int
) -> list[models.GuestCommentSubscription]:
    """Confirmed guest followers of a post's thread (for the approval fan-out).

    Only per-comment rows are returned: a follower on the weekly digest cadence
    (``digest_weekly``, DEC-429) is excluded here because the weekly job covers
    them, so exactly one channel serves a subscriber (DEC-355 parity).
    """
    return list(
        (
            await db.execute(
                select(models.GuestCommentSubscription).where(
                    models.GuestCommentSubscription.post_id == post_id,
                    models.GuestCommentSubscription.is_confirmed.is_(True),
                    models.GuestCommentSubscription.digest_weekly.is_(False),
                )
            )
        ).scalars()
    )


async def set_guest_thread_digest(db: AsyncSession, token: str, digest_weekly: bool) -> bool:
    """Flip a guest thread-subscription's cadence (weekly vs per-comment) via its
    token (round 381, DEC-429). Idempotent; False on an unknown token (no oracle)."""
    row = await get_guest_comment_subscription_by_token(db, token)
    if row is None:
        return False
    if row.digest_weekly != digest_weekly:
        row.digest_weekly = digest_weekly
        await db.commit()
    return True


async def list_confirmed_guest_thread_digest_subs(db: AsyncSession) -> list[models.GuestCommentSubscription]:
    """Every confirmed guest thread-follower on the weekly cadence, for the
    weekly comment-digest job (round 381, DEC-429)."""
    return list(
        (
            await db.execute(
                select(models.GuestCommentSubscription).where(
                    models.GuestCommentSubscription.is_confirmed.is_(True),
                    models.GuestCommentSubscription.digest_weekly.is_(True),
                )
            )
        ).scalars()
    )


async def list_reader_comment_subscriptions(
    db: AsyncSession, reader_id: int, page: int = 1, limit: int = 100
) -> tuple[list[models.Post], int]:
    """The posts whose threads a reader follows, *publicly visible* only, paginated.

    Same invariant as list_reader_bookmarks: a followed post that became a
    draft/private/scheduled must not leak on this read path — it simply stops
    appearing (the follow row is kept; the reader can re-see it, and
    unsubscribe, once the post is public again). Visibility is pushed into SQL
    so pages are stable; returns (items, total) with bounded paging (ISS-142).
    Newest follow first.
    """
    now = utc_now_naive()
    query = (
        select(models.Post)
        .join(models.CommentSubscription, models.CommentSubscription.post_id == models.Post.id)
        .where(
            models.CommentSubscription.reader_id == reader_id,
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
    )
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    rows = list(
        (
            await db.execute(
                query.options(joinedload(models.Post.category), joinedload(models.Post.tags))
                .order_by(
                    models.CommentSubscription.created_at.desc(),
                    models.CommentSubscription.id.desc(),  # id tiebreak (round 278)
                )
                .offset((page - 1) * limit)
                .limit(limit)
            )
        )
        .unique()
        .scalars()
    )
    return [p for p in rows if is_publicly_visible(p)], total


async def comment_subscription_reader_ids(db: AsyncSession, post_id: int) -> list[int]:
    """Distinct reader_ids following a post's comment thread (fan-out target).

    Deduplicates in SQL in case future rows ever violate the ORM guard; the
    caller subtracts the comment author's own reader_id before dispatching.
    """
    return [
        row[0]
        for row in (
            await db.execute(
                select(models.CommentSubscription.reader_id)
                .where(models.CommentSubscription.post_id == post_id)
                .distinct()
            )
        ).all()
    ]
