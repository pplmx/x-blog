"""Reader notification inbox, prefs, mentions, and fan-outs."""

import re
from collections.abc import Collection, Iterable
from typing import Any, cast

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth, models
from app.emailer import (
    EmailItem,
    dispatch_newsletter_new_post,
    dispatch_notification_emails,
    email_channel_enabled,
)
from app.webpush import dispatch_new_post

from ._base import (
    MAX_NOTIFICATIONS_PER_READER,
    MENTION_NOTIF_BODY,
    MENTION_NOTIF_TITLE,
    MENTION_SCAN_LIMIT,
    MENTION_SUGGEST_LIMIT,
    REPLY_NOTIF_BODY,
    REPLY_NOTIF_TITLE,
    THREAD_NOTIF_BODY,
    THREAD_NOTIF_TITLE,
    _reload_post_eager,
    logger,
    utc_now_naive,
)
from .follows import list_author_follow_reader_ids, list_tag_follow_reader_ids


async def _prune_notifications_for_readers(db: AsyncSession, reader_ids: set[int]) -> None:
    """Keep only the newest ``MAX_NOTIFICATIONS_PER_READER`` rows per reader.

    One set-based DELETE over a window function (ROW_NUMBER partitioned by
    reader, ordered by id desc) — portable across SQLite and PostgreSQL. This
    is the batched replacement for ``record_reader_notification``'s
    per-reader "SELECT recent-N + DELETE", which was O(2n) queries in the
    new-post fan-out (ISS-113, supersedes DEC-176's deferral): a heavily
    followed post now pays one delete instead of one per follower. Rows
    just inserted carry the highest ids, so they always rank inside the kept
    window (a fan-out adds at most one row per reader).
    """
    if not reader_ids:
        return
    ranked = (
        select(
            models.ReaderNotification.id,
            func.row_number()
            .over(
                partition_by=models.ReaderNotification.reader_id,
                order_by=models.ReaderNotification.id.desc(),
            )
            .label("rn"),
        ).where(models.ReaderNotification.reader_id.in_(reader_ids))
    ).subquery()
    over_cap = select(ranked.c.id).where(ranked.c.rn > MAX_NOTIFICATIONS_PER_READER)
    await db.execute(delete(models.ReaderNotification).where(models.ReaderNotification.id.in_(over_cap)))


async def record_reader_notification(
    db: AsyncSession,
    reader_id: int,
    kind: str,
    title: str,
    body: str | None = None,
    url: str | None = None,
) -> models.ReaderNotification:
    """Persist one reader-facing notification row (inbox, DEC-160/TASK-192).

    Called at the same dispatch points that fire the Web Push (new post in a
    followed series/category, reply, thread comment) so the durable inbox and
    the ephemeral push stay in sync. Best effort: never raises — a notify path
    must not break the triggering write (publish/comment) because of persistence.
    """
    row = models.ReaderNotification(
        reader_id=reader_id,
        kind=kind,
        title=title,
        body=body,
        url=url,
    )
    try:
        db.add(row)
        await db.flush()
        # Prune to the retention cap (keep newest by id).
        recent_ids = [
            rid
            for (rid,) in (
                await db.execute(
                    select(models.ReaderNotification.id)
                    .where(models.ReaderNotification.reader_id == reader_id)
                    .order_by(models.ReaderNotification.id.desc())
                    .limit(MAX_NOTIFICATIONS_PER_READER)
                )
            ).all()
        ]
        if recent_ids:
            await db.execute(
                delete(models.ReaderNotification).where(
                    models.ReaderNotification.reader_id == reader_id,
                    models.ReaderNotification.id.notin_(recent_ids),
                )
            )
        await db.commit()
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        await db.rollback()
    return row


def notification_copy(
    kind: str,
    post_title: str,
    locale: str | None,
    *,
    commenter: str | None = None,
) -> tuple[str, str]:
    """Localized (title, body) for one reader notification kind.

    Covers every kind the fan-out produces (DEC-338/TASK-395 new_post +
    series_new_part; DEC-340/TASK-396 reply, thread_comment, mention). The
    tuple feeds both the durable inbox row and the email channel (email
    Subject = title, body = body), so one switch localizes every channel.
    ``zh`` is the site default and the behavior for a reader who never set a
    locale (NULL) — exactly today's hardcoded copy, preserving all existing
    behavior (and the operator env overrides for the reply/thread/mention zh
    text). ``en`` is the English surface: plain post titles instead of
    ``《title》`` book-title brackets and English titles/bodies. ``commenter``
    is only meaningful for the ``mention`` kind's body.
    """
    if locale in ("en", "en-US"):
        if kind == "series_new_part":
            return "Series update", post_title
        if kind == "new_post":
            return "New post", post_title
        if kind == "reply":
            return "Someone replied to your comment", f"New reply on {post_title}"
        if kind == "thread_comment":
            return "New comment in a thread you follow", f"New comment on {post_title}"
        if kind == "mention":
            who = commenter or "Someone"
            return "You were mentioned in a comment", f"{who} mentioned you in {post_title}"
        if kind == "reader_comment":
            who = commenter or "A reader you follow"
            return "A reader you follow commented", f"{who} commented on {post_title}"
        return "New notification", post_title
    if kind == "series_new_part":
        return "系列更新", f"《{post_title}》"
    if kind == "new_post":
        return "新文章发布", f"《{post_title}》"
    if kind == "reply":
        return REPLY_NOTIF_TITLE, REPLY_NOTIF_BODY.replace("{post_title}", post_title)
    if kind == "thread_comment":
        return THREAD_NOTIF_TITLE, THREAD_NOTIF_BODY.replace("{post_title}", post_title)
    if kind == "mention":
        return (
            MENTION_NOTIF_TITLE,
            MENTION_NOTIF_BODY.replace("{commenter}", commenter or "").replace("{post_title}", post_title),
        )
    if kind == "reader_comment":
        who = commenter or "你关注的读者"
        return "你关注的读者发表了评论", f"{who} 在《{post_title}》下发表了评论"
    return "Notification", post_title


async def reader_locale_map(db: AsyncSession, reader_ids: Collection[int]) -> dict[int, str | None]:
    """``ReaderAccount.id`` → stored copy locale for the given readers
    (DEC-338, TASK-395), NULL left as the zh site default for callers.

    Loads reader language for a notification fan-out in ONE batch query (the
    locale lives on the account, separate from the prefs row). Indexed by row
    index rather than ``dict(Row(...))`` so pyright sees ``dict[int, str]``
    instead of modeling a SQLAlchemy ``Row`` (which it types as bytes).
    """
    if not reader_ids:
        return {}
    rows = (
        await db.execute(
            select(auth.ReaderAccount.id, auth.ReaderAccount.locale).where(auth.ReaderAccount.id.in_(reader_ids))
        )
    ).all()
    return {int(row[0]): row[1] for row in rows}


async def set_reader_locale(db: AsyncSession, reader_id: int, locale: str) -> str:
    """Persist a reader's notification-copy language (DEC-338, TASK-395).

    Stores the frontend locale code ("en" / "zh"); the fan-out's
    ``notification_copy`` reads it back at dispatch time. Returns the stored
    value. ``locale`` is validated by the router (Literal["en", "zh"]).
    """
    acct = await db.get(auth.ReaderAccount, reader_id)
    if acct is None:
        raise ValueError("Reader not found")
    acct.locale = locale
    await db.commit()
    return locale


async def maybe_notify_due_scheduled_posts(db: AsyncSession) -> int:
    """Fire the new-post fan-out for scheduled posts whose ``publish_at`` has
    now passed but that were never announced (DEC-336, TASK-394).

    A post created as published-but-future ``publish_at`` becomes publicly
    visible the moment the clock crosses it, but both write-time fan-outs are
    gated on visibility AT WRITE TIME: create_post skips a still-future
    publish_at and update_post only fires on a draft->visible transition, so
    the crossing itself has no trigger — there is no background scheduler
    (DEC-076). This helper is the fire-on-read sweep: called from the public
    read paths that surface a post after its crossing (post list, post detail,
    RSS/Atom feeds), it claims every crossed-but-unannounced post atomically
    and runs the same batched fan-out as an immediate publish.

    Exactly-once: the ``new_post_notified_at`` stamp is written with an atomic
    conditional UPDATE (``... WHERE id = ? AND stamp IS NULL``), so concurrent
    sweep calls across uvicorn workers (DEC-004) cannot both claim the same
    post; the stamp is committed before any dispatch, so even a crash mid-fan-
    out cannot cause a duplicate. Best effort by construction — the fan-out
    helpers never raise — and a claim already stamped is skipped. Returns the
    number of posts newly claimed (0 when nothing crossed).
    """
    now = utc_now_naive()
    due_ids = [
        pid
        for (pid,) in (
            await db.execute(
                select(models.Post.id).where(
                    models.Post.published.is_(True),
                    models.Post.publish_at.isnot(None),
                    models.Post.publish_at <= now,
                    models.Post.new_post_notified_at.is_(None),
                )
            )
        ).all()
    ]
    if not due_ids:
        return 0
    claimed: list[int] = []
    for pid in due_ids:
        won = cast(
            CursorResult[Any],
            await db.execute(
                update(models.Post)
                .where(
                    models.Post.id == pid,
                    models.Post.new_post_notified_at.is_(None),
                )
                .values({"new_post_notified_at": now})
            ),
        ).rowcount
        if won:
            claimed.append(pid)
    if claimed:
        await db.commit()
    # Dispatch after the stamp commit so a best-effort send failure can never
    # be retried as a duplicate (the stamp already proves the claim happened).
    for pid in claimed:
        # Eager-load relationships (tags/series/category) for the fan-out —
        # async: post-commit lazy access raises MissingGreenlet.
        post = await _reload_post_eager(db, pid)
        if post is None:
            continue
        await record_new_post_notifications(db, post)
        await dispatch_new_post(db, post, logger)
        await dispatch_newsletter_new_post(db, post, logger)
    return len(claimed)


async def record_new_post_notifications(db: AsyncSession, post: models.Post) -> None:
    """Persist a new-post inbox notification for every reader who follows the
    post's series or category (DEC-160, TASK-192).

    Mirrors the follower targeting of ``dispatch_new_post`` (series followers +
    category followers + tag followers with notify on), but persists to the
    durable inbox instead of (or in addition to) the ephemeral browser push.
    Independent of VAPID configuration: a reader should still get an inbox row
    even when Web Push is not set up. Best effort, never raises. ``post`` must
    be the just-persisted, publicly-visible post (callers gate on
    ``is_publicly_visible``).

    Kind (ISS-114, DEC-181): a series follow surfaces the distinct
    ``series_new_part`` kind (frontend icons/labels it 系列更新) while a
    category-only (or tag-only) follow keeps ``new_post`` (新文章发布). A
    reader following both the series AND the category/tag of the same post gets
    exactly one row, preferring ``series_new_part`` — the series follow is the
    more specific signal for the same event. Tag followers (DEC-195/TASK-215)
    join under the same ``new_post`` umbrella. Both kinds stay gated by the
    single ``new_post`` opt-out (DEC-171 umbrella): a series update IS a new
    post, so a reader who silenced new_post is not woken for series parts.
    """
    try:
        series_reader_ids: set[int] = set()
        category_reader_ids: set[int] = set()
        tag_reader_ids: set[int] = set()
        author_reader_ids: set[int] = set()
        # Readers who follow this post's series ('new part' notification).
        if post.series_id is not None:
            series_reader_ids.update(
                rid
                for (rid,) in (
                    await db.execute(
                        select(models.SeriesFollow.reader_id).where(
                            models.SeriesFollow.series_id == post.series_id,
                            models.SeriesFollow.notify.is_(True),
                        )
                    )
                ).all()
            )
        # Readers who follow this post's category with notifications on.
        if post.category_id is not None:
            category_reader_ids.update(
                rid
                for (rid,) in (
                    await db.execute(
                        select(models.CategoryFollow.reader_id).where(
                            models.CategoryFollow.category_id == post.category_id,
                            models.CategoryFollow.notify.is_(True),
                        )
                    )
                ).all()
            )
        # Readers who follow any of this post's tags with notifications on
        # (DEC-195/TASK-215). One query for the whole tag set.
        tag_ids = [t.id for t in (post.tags or [])]
        if tag_ids:
            tag_reader_ids.update(await list_tag_follow_reader_ids(db, tag_ids))
        # Readers who follow this post's AUTHOR with notifications on (round
        # 353): a writer follow is the person-shaped umbrella over topic-shaped
        # category/series follows — a reader follows the person, so the person's
        # new posts (topic regardless) reach them under the same new_post kind.
        if post.author_id is not None:
            author_reader_ids.update(await list_author_follow_reader_ids(db, post.author_id))
        target_reader_ids = series_reader_ids | category_reader_ids | tag_reader_ids | author_reader_ids
        # A deactivated reader is a moderation action: they keep their follow
        # rows, but must not still receive the durable inbox row (DEC-194,
        # RIL ISS-278). The email fan-out and push already filter is_active —
        # the inbox was the last channel that didn't.
        if target_reader_ids:
            active_ids = {
                rid
                for (rid,) in (
                    await db.execute(
                        select(auth.ReaderAccount.id).where(
                            auth.ReaderAccount.id.in_(target_reader_ids),
                            auth.ReaderAccount.is_active.is_(True),
                        )
                    )
                ).all()
            }
            target_reader_ids &= active_ids
        # Per-kind opt-out (DEC-171, TASK-202): batch-load every target's prefs
        # once. The same reader-level intent gates the push in
        # webpush.dispatch_new_post (which also reaches want_new_posts push
        # subscriptions with no follow), so an opted-out reader gets neither an
        # inbox row here nor a new_post push.
        prefs = await reader_notification_prefs_for(db, target_reader_ids)
        # Batch the fan-out (ISS-113, supersedes DEC-176): build every row up
        # front, add all with one flush + one commit, then prune the whole
        # inbox retention cap for all touched readers with a single set-based
        # window-function delete — instead of record_reader_notification's
        # per-reader SELECT-recent-200 + DELETE + commit (O(2n) queries per
        # publish on a heavily followed post). The single commit also makes the
        # fan-out atomic: either every follower's inbox row lands or none does.
        # Reader language for the copy (DEC-338, TASK-395): one batch query for
        # every target's stored locale (NULL reads as the zh site default). Locale
        # lives on the account, separate from the prefs row, so load it once here.
        locale_of = await reader_locale_map(db, target_reader_ids)
        rows: list[models.ReaderNotification] = []
        email_items: list[EmailItem] = []
        for reader_id in target_reader_ids:
            if not notification_kind_enabled(prefs.get(reader_id), "new_post"):
                continue
            is_series_part = reader_id in series_reader_ids
            kind = "series_new_part" if is_series_part else "new_post"
            title, body = notification_copy(kind, post.title or "", locale_of.get(reader_id))
            rows.append(
                models.ReaderNotification(
                    reader_id=reader_id,
                    kind=kind,
                    title=title,
                    body=body,
                    url=f"/posts/{post.slug}",
                )
            )
            # Email channel (DEC-197, TASK-217): a best-effort off-site copy of
            # the same fan-out, only for readers who opted into email for the
            # kind. The email Subject is item.title and the body is item.body,
            # so the localized copy carries straight through to email.
            if email_channel_enabled(prefs.get(reader_id), kind):
                email_items.append(
                    EmailItem(
                        reader_id=reader_id,
                        kind=kind,
                        title=title,
                        body=body,
                        url=f"/posts/{post.slug}",
                    )
                )
        if rows:
            db.add_all(rows)
            await db.flush()  # assign ids so the prune's id ordering is exact
            await _prune_notifications_for_readers(db, {r.reader_id for r in rows})
            await db.commit()  # inserts + prune land atomically
        # Send after the inbox commit so a mail failure can't affect the durable
        # rows; dispatch_notification_emails never raises (best effort).
        await dispatch_notification_emails(db, email_items, logger)
    except Exception:  # noqa: BLE001 — best effort, never fail the publish
        await db.rollback()


async def resolve_mention_reader_ids(db: AsyncSession, content: str) -> list[int]:
    """Reader ids whose display name is @-mentioned verbatim in ``content``.

    A mention is ``@<display_name>`` with word boundaries on both sides — so
    ``@Riki`` names reader "Riki" but never a reader named "Ri" (a naive
    substring would misfire on the longer name). Runs only at approval time
    (human-paced) and fast-paths when the comment has no ``@``, so the read path
    never pays for it. (DEC-322, TASK-389)
    """
    if not content or "@" not in content:
        return []
    rows = (
        await db.execute(
            select(auth.ReaderAccount.id, auth.ReaderAccount.display_name)
            .where(auth.ReaderAccount.display_name.is_not(None))
            .limit(MENTION_SCAN_LIMIT + 1)
        )
    ).all()
    if len(rows) > MENTION_SCAN_LIMIT:
        return []  # beyond resolution scale — never silently partial-match
    hits: list[int] = []
    for rid, name in rows:
        if name and re.search(rf"(?<!\w)@{re.escape(name)}(?!\w)", content):
            hits.append(rid)
    return hits


async def suggest_mention_readers(
    db: AsyncSession,
    query: str,
    *,
    limit: int = MENTION_SUGGEST_LIMIT,
) -> list[dict[str, Any]]:
    """Active readers with a display name matching an '@'-mention picker query.

    Public picker data for the comment box (DEC-324, TASK-390): case-insensitive
    substring match on the display name with LIKE wildcards escaped (a ''%'' query
    must not match everything), prefix matches ranked before substring-only ones,
    display-name-asc within a rank, and a hard ``limit`` so a one-character query
    can never dump the reader table. Only id/display_name/avatar leave the
    boundary — the caller serializes them; the email never leaves this function.
    An empty query returns the first few named active readers so a bare '@' still
    has something to show.
    """
    esc = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    stmt = select(
        auth.ReaderAccount.id,
        auth.ReaderAccount.display_name,
        auth.ReaderAccount.avatar_url,
    ).where(
        auth.ReaderAccount.is_active.is_(True),
        auth.ReaderAccount.display_name.is_not(None),
    )
    if esc:
        prefix = auth.ReaderAccount.display_name.ilike(f"{esc}%", escape="\\")
        contains = auth.ReaderAccount.display_name.ilike(f"%{esc}%", escape="\\")
        stmt = stmt.where(contains).order_by(
            case((prefix, 0), else_=1),
            auth.ReaderAccount.display_name.asc(),
        )
    else:
        stmt = stmt.order_by(auth.ReaderAccount.display_name.asc())
    rows = (await db.execute(stmt.limit(limit + 1))).all()
    return [{"id": rid, "display_name": name or "", "avatar_url": avatar} for (rid, name, avatar) in rows[:limit]]


async def _notification_rows(
    db: AsyncSession,
    reader_ids: list[int],
    *,
    kind: str,
    post_title: str,
    url: str,
    commenter: str | None = None,
) -> list[models.ReaderNotification]:
    """Per-reader-localized ReaderNotification rows for a batched fan-out.

    Loads each target's stored locale once (DEC-340/TASK-396, same batch
    pattern as the new-post fan-out in round 332) so an English reader's row
    carries English copy alongside a zh reader's Chinese copy in the SAME
    batch — one flush, one prune, one commit. ``commenter`` supplies the
    mention body's acting reader label.
    """
    locale_of = await reader_locale_map(db, reader_ids)
    return [
        models.ReaderNotification(
            reader_id=rid,
            kind=kind,
            title=title,
            body=body,
            url=url,
        )
        for rid in reader_ids
        for (title, body) in [notification_copy(kind, post_title, locale_of.get(rid), commenter=commenter)]
    ]


async def record_reader_follow_notifications(
    db: AsyncSession,
    reader_ids: list[int],
    *,
    commenter: str,
    post_title: str,
    url: str,
) -> None:
    """Persist a 'reader you follow commented' inbox row for every follower at
    once (round 365, DEC-403).

    Same batched, atomic, best-effort contract as the thread-comment and
    mention fan-outs: build every row (localized per reader), flush once, prune
    once, commit once; never raises so an approving comment cannot break on
    notification persistence.
    """
    try:
        rows = await _notification_rows(
            db,
            reader_ids,
            kind="reader_comment",
            post_title=post_title,
            url=url,
            commenter=commenter,
        )
        if not rows:
            return
        db.add_all(rows)
        await db.flush()
        await _prune_notifications_for_readers(db, set(reader_ids))
        await db.commit()
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        await db.rollback()


async def record_mention_notifications(
    db: AsyncSession,
    reader_ids: list[int],
    *,
    post_title: str,
    commenter: str,
    url: str,
) -> None:
    """Persist an @-mention inbox row for every mentioned reader at once.

    Batched counterpart of record_thread_comment_notifications for the
    mention approval fan-out (DEC-322, TASK-389): build every row, flush once,
    prune once, commit once — atomic and failure-proof like the other fan-outs.
    Copy is localized per reader (DEC-340/TASK-396).
    """
    try:
        rows = await _notification_rows(
            db,
            reader_ids,
            kind="mention",
            post_title=post_title,
            commenter=commenter,
            url=url,
        )
        if not rows:
            return
        db.add_all(rows)
        await db.flush()  # assign ids so the prune's id ordering is exact
        await _prune_notifications_for_readers(db, set(reader_ids))
        await db.commit()  # inserts + prune land atomically
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        await db.rollback()


async def record_thread_comment_notifications(
    db: AsyncSession,
    reader_ids: list[int],
    *,
    post_title: str,
    url: str,
) -> None:
    """Persist a thread-comment inbox row for every follower at once.

    Batched counterpart of record_reader_notification for the thread-comment
    approval fan-out (ISS-427): the previous per-follower loop called
    record_reader_notification for N readers, each doing a flush + a
    SELECT-recent-200 + a DELETE + a commit — O(2n) queries and N transactions
    for one approved comment on a heavily subscribed thread. Build every row,
    flush once, prune once, commit once (the same batched pattern
    record_new_post_notifications introduced for new-post fan-out, ISS-113).
    The single commit also makes the fan-out atomic. Copy is localized per
    reader (DEC-340/TASK-396). Best effort: never raises so a notify path
    cannot break the approving write.
    """
    try:
        rows = await _notification_rows(
            db,
            reader_ids,
            kind="thread_comment",
            post_title=post_title,
            url=url,
        )
        if not rows:
            return
        db.add_all(rows)
        await db.flush()  # assign ids so the prune's id ordering is exact
        await _prune_notifications_for_readers(db, set(reader_ids))
        await db.commit()  # inserts + prune land atomically
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        await db.rollback()


# Notification-kind opt-outs (DEC-171, TASK-202). The preferences surface
# exposes exactly these toggles. Dispatch can also produce series_new_part as a
# label refinement of new_post (ISS-114, DEC-181) — it is never a separate
# toggle because a series update IS a new post; the new_post kill-switch gates
# it.
NOTIFICATION_KINDS: tuple[str, ...] = ("new_post", "reply", "thread_comment", "mention", "reader_comment")


# Email channel (DEC-197, TASK-217): per-kind opt-ins accepted by the same
# PATCH endpoint. The fan-out gating for these lives in emailer.email_channel_enabled.
# email_weekly_digest (DEC-201, TASK-222) is the recurring digest opt-in — same
# toggle surface, but not a fan-out kind (the digest job reads it directly).
EMAIL_KINDS: tuple[str, ...] = (
    "email_new_post",
    "email_reply",
    "email_thread_comment",
    "email_mention",
    "email_weekly_digest",
)


PREF_KINDS: tuple[str, ...] = NOTIFICATION_KINDS + EMAIL_KINDS


async def get_reader_notification_prefs(db: AsyncSession, reader_id: int) -> models.ReaderNotificationPref:
    """The reader's per-kind notification prefs, materializing an all-on row
    the first time it is read (GET). Dispatch gating must NOT call this — it
    writes; use ``reader_notification_prefs_for`` for fan-out paths.
    (DEC-171, TASK-202)
    """
    row = await db.get(models.ReaderNotificationPref, reader_id)
    if row is None:
        row = models.ReaderNotificationPref(reader_id=reader_id)
        db.add(row)
        try:
            await db.commit()
        except IntegrityError:
            # Two concurrent first-reads raced to materialize the row (reader_id
            # is that table's PK): we lost the insert. The winner's row is now
            # committed — read it back instead of 500ing (backend deep-dive).
            await db.rollback()
            row = await db.get(models.ReaderNotificationPref, reader_id)
            if row is not None:
                return row
            raise
        await db.refresh(row)
    return row


async def reader_notification_prefs_for(
    db: AsyncSession, reader_ids: Iterable[int]
) -> dict[int, models.ReaderNotificationPref | None]:
    """Batch pref lookup for dispatch gating — read-only, never writes.

    Returns {reader_id: pref_row}. Missing readers are absent (treat as all-on
    via ``notification_kind_enabled``), so a reader who never opted out keeps
    getting every kind without materializing a row in hot fan-out paths.
    (DEC-171, TASK-202)
    """
    ids = list(reader_ids)
    if not ids:
        return {}
    rows = list(
        (
            await db.execute(
                select(models.ReaderNotificationPref).where(models.ReaderNotificationPref.reader_id.in_(ids))
            )
        ).scalars()
    )
    return {r.reader_id: r for r in rows}


def notification_kind_enabled(pref: models.ReaderNotificationPref | None, kind: str) -> bool:
    """True when a reader allows ``kind`` to fan out. A missing pref row (None)
    reads as enabled — defaults are all-on. Callers pass the row from
    ``reader_notification_prefs_for``. (DEC-171, TASK-202)
    """
    if pref is None:
        return True
    return bool(getattr(pref, kind, True))


async def set_reader_notification_kind(
    db: AsyncSession, reader_id: int, kind: str, enabled: bool
) -> models.ReaderNotificationPref | None:
    """Toggle one notification kind for a reader; returns the updated row.

    ``kind`` must be in ``PREF_KINDS`` (whitelist — never write an
    attacker-controlled attribute). None if the kind is rejected; the router
    422s on that. (DEC-171, TASK-202; email channel DEC-197)
    """
    if kind not in PREF_KINDS:
        return None
    row = await db.get(models.ReaderNotificationPref, reader_id)
    if row is None:
        row = models.ReaderNotificationPref(reader_id=reader_id)
        db.add(row)
    setattr(row, kind, enabled)
    row.updated_at = utc_now_naive()
    try:
        await db.commit()
    except IntegrityError:
        # Same first-materialization race as get_reader_notification_prefs: a
        # concurrent request inserted the row between our get and commit. Its
        # row is now committed — re-read it (all-defaults + the other writer's
        # toggles), apply this toggle, and commit on top instead of 500ing.
        await db.rollback()
        row = await db.get(models.ReaderNotificationPref, reader_id)
        if row is None:
            raise
        setattr(row, kind, enabled)
        row.updated_at = utc_now_naive()
        await db.commit()
        await db.refresh(row)
    return row


async def list_reader_notifications(
    db: AsyncSession, reader_id: int, page: int = 1, limit: int = 20, unread_only: bool = False
) -> tuple[list[models.ReaderNotification], int]:
    """The reader's notification inbox rows, newest first, paginated.

    ``unread_only`` filters to rows with read_at NULL (for an unread badge).
    Returns (items, total). Unlike the post lists, inbox rows do not carry a
    public-visibility check — a notification points at a post that may later be
    unpublished, but the inbox records the *event*, not current visibility.
    """
    query = select(models.ReaderNotification).where(models.ReaderNotification.reader_id == reader_id)
    if unread_only:
        query = query.where(models.ReaderNotification.read_at.is_(None))
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    items = list(
        (
            await db.execute(
                query.order_by(models.ReaderNotification.id.desc()).offset((page - 1) * limit).limit(limit)
            )
        ).scalars()
    )
    return items, total


async def unread_notification_count(db: AsyncSession, reader_id: int) -> int:
    """How many of the reader's notifications are unread (for a badge)."""
    return (
        await db.execute(
            select(func.count()).select_from(
                select(models.ReaderNotification)
                .where(
                    models.ReaderNotification.reader_id == reader_id,
                    models.ReaderNotification.read_at.is_(None),
                )
                .subquery()
            )
        )
    ).scalar() or 0


async def mark_reader_notification_read(db: AsyncSession, reader_id: int, notification_id: int) -> bool:
    """Mark one of the reader's notifications read. Returns False if not theirs."""
    row = (
        (
            await db.execute(
                select(models.ReaderNotification).where(
                    models.ReaderNotification.id == notification_id,
                    models.ReaderNotification.reader_id == reader_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        return False
    if row.read_at is None:
        row.read_at = utc_now_naive()
        await db.commit()
    return True


async def mark_all_reader_notifications_read(db: AsyncSession, reader_id: int) -> int:
    """Mark every unread notification of a reader read; returns count updated."""
    updated = cast(
        CursorResult[Any],
        await db.execute(
            update(models.ReaderNotification)
            .where(
                models.ReaderNotification.reader_id == reader_id,
                models.ReaderNotification.read_at.is_(None),
            )
            .values({models.ReaderNotification.read_at: utc_now_naive()})
        ),
    ).rowcount
    await db.commit()
    return updated


async def delete_reader_notification(db: AsyncSession, reader_id: int, notification_id: int) -> bool:
    """Delete one of the reader's inbox rows. Returns False if not theirs.

    The inbox is durable (DEC-160) but had no pruning path — mark-read/read-all
    only clear the badge, so consumed notification rows accumulate forever.
    Delete is scoped by reader_id like every reader table: a reader removes
    exactly their own row, and an unknown/foreign id is a miss (404), never a
    cross-reader delete. (DEC-312, TASK-384)
    """
    row = (
        (
            await db.execute(
                select(models.ReaderNotification).where(
                    models.ReaderNotification.id == notification_id,
                    models.ReaderNotification.reader_id == reader_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        return False
    await db.delete(row)
    await db.commit()
    return True
