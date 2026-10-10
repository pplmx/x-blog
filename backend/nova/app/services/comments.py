"""
Comments service: comment read/write orchestration plus the notification fan-out (thread/reply/mention/reader-follow + guest thread emails) that formerly lived inline in the comments router.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth, models
from app.emailer import (
    EmailItem,
    dispatch_notification_emails,
    email_channel_enabled,
    is_email_configured,
    send_guest_comment_manage_email,
    send_guest_reply_email,
    send_guest_thread_emails,
)
from app.middleware import get_logger
from app.repositories._base import (
    REPLY_NOTIF_BODY,
    REPLY_NOTIF_TITLE,
    THREAD_NOTIF_BODY,
    THREAD_NOTIF_TITLE,
    is_publicly_visible,
    utc_now_naive,
)
from app.repositories.comments import (
    approve_comment,
    create_comment,
    delete_comment,
    delete_guest_comment,
    flag_comment,
    get_comments_paginated,
    get_guest_comment_by_token,
    like_comment,
    list_public_comment_feed,
    update_guest_comment,
)
from app.repositories.follows import (
    get_reader_block,
    list_reader_follower_ids,
    readers_who_block,
)
from app.repositories.notifications import (
    notification_copy,
    notification_kind_enabled,
    reader_locale_map,
    reader_notification_prefs_for,
    record_mention_notifications,
    record_reader_follow_notifications,
    record_reader_notification,
    record_thread_comment_notifications,
    resolve_mention_reader_ids,
)
from app.repositories.settings import (
    boolean_setting,
)
from app.repositories.subscriptions import (
    comment_subscription_reader_ids,
    list_confirmed_guest_comment_subscribers,
)
from app.webpush import (
    dispatch_to_subscriptions,
    vapid_configured,
)

logger = get_logger(__name__)

__all__ = [
    "REPLY_NOTIF_BODY",
    "REPLY_NOTIF_TITLE",
    "THREAD_NOTIF_BODY",
    "THREAD_NOTIF_TITLE",
    "_maybe_email_guest_manage_link",
    "_maybe_notify_guest_replied_to",
    "_notify_comment_approved",
    "_notify_guest_thread_subscribers",
    "_notify_mentions",
    "_notify_reader_followers",
    "_notify_replied_to",
    "_notify_thread_subscribers",
    "approve_comment",
    "boolean_setting",
    "comment_subscription_reader_ids",
    "create_comment",
    "delete_comment",
    "delete_guest_comment",
    "flag_comment",
    "get_comments_paginated",
    "get_guest_comment_by_token",
    "get_reader_block",
    "is_publicly_visible",
    "like_comment",
    "list_confirmed_guest_comment_subscribers",
    "list_public_comment_feed",
    "list_reader_follower_ids",
    "notification_copy",
    "notification_kind_enabled",
    "reader_locale_map",
    "reader_notification_prefs_for",
    "readers_who_block",
    "record_mention_notifications",
    "record_reader_follow_notifications",
    "record_reader_notification",
    "record_thread_comment_notifications",
    "resolve_mention_reader_ids",
    "update_guest_comment",
    "utc_now_naive",
]


async def _notify_thread_subscribers(
    post: models.Post,
    new_comment_id: int,
    exclude_reader_ids: set[int],
    db: AsyncSession,
    commenter_id: int | None = None,
) -> None:
    """Push 'a new comment was approved on a thread you follow' to followers.

    Fired when any comment is approved (this blog moderates every comment:
    followers should only hear about comments they can actually see). Target:
    every reader following the post's thread minus ``exclude_reader_ids`` —
    the comment's own author (no self-notification) and, for a reply, the
    replied-to reader (they already get the targeted reply notification,
    DEC-064; doubling it would push twice). A subscriber who blocked the
    commenter is also dropped (DEC-425): blocking is a receiver-side opt-out,
    so a blocked commenter is invisible to them even mid-thread. Best effort:
    VAPID unconfigured or no subscribers is a silent no-op — moderation must
    never fail because of notifications. Dead (404/410) subscriptions are
    retired by the shared dispatch helper. (DEC-078, TASK-150)
    """
    target_ids = [rid for rid in await comment_subscription_reader_ids(db, post.id) if rid not in exclude_reader_ids]
    if commenter_id is not None:
        blocked = await readers_who_block(db, commenter_id, target_ids)
        if blocked:
            target_ids = [rid for rid in target_ids if rid not in blocked]
    # Deactivation silences every channel (DEC-194, RIL ISS-278): a deactivated
    # reader keeps their thread subscription row, but must not get the inbox
    # push below (their email is already filtered in dispatch_notification_emails).
    if target_ids:
        rows = (
            await db.execute(
                select(auth.ReaderAccount.id).filter(
                    auth.ReaderAccount.id.in_(target_ids),
                    auth.ReaderAccount.is_active.is_(True),
                )
            )
        ).all()
        active_ids = {rid for (rid,) in rows}
        target_ids = [rid for rid in target_ids if rid in active_ids]
    # Per-kind opt-out (DEC-171, TASK-202): readers who turned 'thread_comment'
    # off are dropped before both the inbox row and the push fan-out below.
    target_prefs = await reader_notification_prefs_for(db, target_ids)
    target_ids = [rid for rid in target_ids if notification_kind_enabled(target_prefs.get(rid), "thread_comment")]
    if not target_ids:
        return
    # Persist to the durable reader inbox (independent of VAPID) so a reader
    # sees the new comment in-app even if the browser push is missed/unconfigured.
    # Batched (ISS-427): build every follower's row, flush + prune + commit once
    # — the old per-follower record_reader_notification loop paid O(2n) queries
    # and N transactions per approved comment on a big thread.
    await record_thread_comment_notifications(
        db,
        target_ids,
        post_title=post.title or "",
        url=f"/posts/{post.slug}#comment-{new_comment_id}",
    )
    # Email channel (DEC-197, TASK-217): best-effort off-site copy for thread
    # followers who opted into email for the kind — localized per reader the
    # same way as the inbox rows (DEC-340/TASK-396). One locale query for the
    # whole target set, then per-reader copy.
    email_locales = await reader_locale_map(db, target_ids)
    await dispatch_notification_emails(
        db,
        [
            EmailItem(
                rid,
                "thread_comment",
                *notification_copy("thread_comment", post.title or "", email_locales.get(rid)),
                f"/posts/{post.slug}#comment-{new_comment_id}",
            )
            for rid in target_ids
            if email_channel_enabled(target_prefs.get(rid), "thread_comment")
        ],
        logger,
    )
    if not vapid_configured():
        return
    subscriptions = (
        (await db.execute(select(models.PushSubscription).filter(models.PushSubscription.reader_id.in_(target_ids))))
        .scalars()
        .all()
    )
    if not subscriptions:
        return
    payload = {
        "title": THREAD_NOTIF_TITLE,
        # replace (not .format) so a { } in the post title can't raise and
        # break the approval — this path must stay best-effort.
        "body": THREAD_NOTIF_BODY.replace("{post_title}", post.title or ""),
        # Deep-link to the new approved comment (DEC-072 anchor scroll).
        "url": f"/posts/{post.slug}#comment-{new_comment_id}",
    }
    await dispatch_to_subscriptions(subscriptions, payload, db, logger)


async def _notify_guest_thread_subscribers(
    post: models.Post,
    comment: models.Comment,
    db: AsyncSession,
) -> None:
    """Guest thread-follow fan-out (DEC-427, TASK-438): email every CONFIRMED
    guest subscriber of the post that a new comment is approved.

    The anonymous counterpart of ``_notify_thread_subscribers`` — a guest
    subscription is keyed by (email, post) with no account, so this goes
    straight through the SMTP path (``send_guest_thread_emails``, like the guest
    reply-email, DEC-332) with a one-click unsubscribe token. Fires only for
    APPROVED comments (every comment is moderated, so subscribers hear about
    comments they can actually see — same rule as the reader fan-out).
    Best effort: never fails the approval; SMTP unconfigured is a silent skip.
    The commenter's own address is skipped — a guest who subscribes and then
    comments must not get an email about their own comment (same self-rule as
    the reader branch), and a signed-in commenter whose reader email matches a
    guest row is skipped too (they already get the reader fan-out above).
    Followers on the weekly digest cadence are excluded here (DEC-429): the
    digest job owns them, so a subscriber is served by exactly one channel.
    """
    subscribers = await list_confirmed_guest_comment_subscribers(db, post.id)
    if not subscribers:
        return
    commenter_email = comment.email.strip().casefold() if comment.email else None
    if comment.reader_id is not None:
        account = await db.get(auth.ReaderAccount, comment.reader_id)
        if account is not None and account.email:
            commenter_email = account.email.strip().casefold()
    url = f"/posts/{post.slug}#comment-{comment.id}"
    # Build the recipient list, then deliver ALL messages in ONE SMTP session
    # (round-433): the old per-subscriber send opened a fresh connection per
    # address in a serial loop — unbounded by any cap and uninterruptible by
    # the request-timeout middleware, so a popular thread stalled the approval.
    recipients = [
        (sub.email, f"/comment-subscribe/unsubscribe?token={sub.token}")
        for sub in subscribers
        if not (commenter_email and sub.email.strip().casefold() == commenter_email)
    ]
    try:
        send_guest_thread_emails(
            recipients,
            post_title=post.title or "",
            comment_url=url,
        )
    except Exception:  # noqa: BLE001 — best effort, never fail the approval
        logger.exception("guest thread fan-out email failed for %d recipients", len(recipients))


async def _notify_replied_to(
    parent_reader: auth.ReaderAccount,
    post: models.Post,
    reply_comment_id: int,
    db: AsyncSession,
    commenter_id: int | None = None,
) -> None:
    """Push 'someone replied to your comment' to the replied-to reader.

    Fired when a *reply is approved* (this blog moderates every comment, DEC-064:
    a reader should only hear about a reply they can actually see — notifying at
    create-time would leak pending/spam replies). Target: the parent comment's
    author if they are a reader with a push subscription. A replied-to reader
    who blocked the replier hears nothing (DEC-425) — blocking is a receiver-side
    opt-out, and the reply is exactly the channel a block is meant to silence.
    Best effort: VAPID
    unconfigured or missing subscriptions is a silent no-op — moderation must
    never fail because of notifications. Dead (404/410) subscriptions are retired
    via the shared dispatch helper. (DEC-064, TASK-137; DEC-072, TASK-145)
    """
    # Reader-block opt-out (DEC-425, TASK-437): a parent-author who blocked the
    # replier receives nothing — the reply is the channel the block silences.
    if commenter_id is not None and await get_reader_block(db, parent_reader.id, commenter_id):
        return
    # Per-kind opt-out (DEC-171, TASK-202): a replied-to reader who turned
    # 'reply' off gets neither the inbox row nor the push.
    target_prefs = await reader_notification_prefs_for(db, [parent_reader.id])
    if not notification_kind_enabled(target_prefs.get(parent_reader.id), "reply"):
        return
    # Localized copy for THIS reader (DEC-340/TASK-396): the durable inbox row
    # and email both carry the reader's language; the push payload below stays
    # the server-global env copy (one payload per browser, not per reader).
    reply_title, reply_body = notification_copy("reply", post.title or "", parent_reader.locale)
    # Persist to the durable reader inbox (independent of VAPID) so the replied-to
    # reader sees the reply in-app even if the browser push is missed/unconfigured.
    await record_reader_notification(
        db,
        parent_reader.id,
        kind="reply",
        title=reply_title,
        body=reply_body,
        url=f"/posts/{post.slug}#comment-{reply_comment_id}",
    )
    # Email channel (DEC-197, TASK-217): best-effort off-site copy for the
    # replied-to reader if they opted into email for replies.
    if email_channel_enabled(target_prefs.get(parent_reader.id), "reply"):
        await dispatch_notification_emails(
            db,
            [
                EmailItem(
                    parent_reader.id,
                    "reply",
                    reply_title,
                    reply_body,
                    f"/posts/{post.slug}#comment-{reply_comment_id}",
                )
            ],
            logger,
        )
    if not vapid_configured():
        return
    payload = {
        "title": REPLY_NOTIF_TITLE,
        # replace (not .format) so a { } in the post title can't raise and
        # break the comment create — this path must stay best-effort.
        "body": REPLY_NOTIF_BODY.replace("{post_title}", post.title or ""),
        # Deep-link to the replied-to comment so tapping the notification lands
        # on the reply, not the top of a long post (DEC-072, TASK-145).
        "url": f"/posts/{post.slug}#comment-{reply_comment_id}",
    }
    subs = (
        (
            await db.execute(
                select(models.PushSubscription).filter(models.PushSubscription.reader_id == parent_reader.id)
            )
        )
        .scalars()
        .all()
    )
    if subs:
        await dispatch_to_subscriptions(subs, payload, db, logger)


async def _maybe_notify_guest_replied_to(
    parent: models.Comment,
    comment: models.Comment,
    post: models.Post,
) -> None:
    """Best-effort guest reply-email (DEC-332/TASK-392): an approved reply to an
    ANONYMOUS comment that consented notifies the guest at their stored address.

    ``dispatch_notification_emails`` cannot carry this (it targets reader
    accounts + per-kind prefs), so we send straight through the SMTP path. The
    email deep-links to the reply and carries a per-comment token that flips
    ``reply_notify_email`` off (the unsubscribe endpoint), keeping the consent
    revocable without an account. Never raises — the approve that fired this
    must not break on a mail failure (best effort, mirrors every other channel).
    """
    # Only anonymous parents that consented AND have an address qualify
    # (consent with no email is stored off at create time, DEC-332).
    if parent.reader_id is not None or not parent.reply_notify_email or not parent.email:
        return
    # A guest replying to their own comment (same address) is not "someone
    # replied to me" — skip, mirroring the reader branch's self-reply guard.
    if (
        comment.reader_id is None
        and comment.email
        and comment.email.strip().casefold() == parent.email.strip().casefold()
    ):
        return
    if not is_email_configured() or parent.reply_notify_token is None:
        return
    try:
        send_guest_reply_email(
            parent.email,
            post_title=post.title or "",
            reply_url=f"/posts/{post.slug}#comment-{comment.id}",
            unsubscribe_url=f"/comment-reply-unsubscribe?token={parent.reply_notify_token}",
        )
    except Exception:  # noqa: BLE001 — best effort, never fail the approval
        logger.exception("guest reply-email dispatch failed")


async def _notify_comment_approved(db: AsyncSession, comment: models.Comment) -> None:
    """Fire the notifications for a comment that just became public.

    Shared by the admin approve endpoint and the verified-reader auto-approve
    path (DEC-098, TASK-161): a reply notifies the replied-to reader, then the
    thread's followers. Best-effort — never fails the approve, mirroring the
    existing approve_comment guarantees (DEC-064/072/078).

    Once-only (round 393): the fan-out runs at most once per comment, stamped in
    ``Comment.notified_at`` (mirroring Post.new_post_notified_at). ``reviewed_at``
    (the routers' ``before`` guard) only knows the immediately-prior state, so a
    moderator rejecting and re-approving a comment — approve → reject → approve —
    would otherwise fire the whole multi-channel fan-out AGAIN: duplicate pushes,
    duplicate durable inbox rows and duplicate emails to the replied-to reader,
    @-mentions, followers and every guest thread subscriber, for content that
    hasn't changed. Claim the stamp (and commit it) before any channel work, so a
    concurrent re-approve sees it. All call sites are post-commit for their own
    write, so the mid-function commit is safe.
    """
    if comment.notified_at is not None:
        return
    comment.notified_at = utc_now_naive()
    await db.commit()
    # NOTE: no db.refresh(comment) here — expire_on_commit=False keeps this
    # object's attributes (incl. the joinedloaded `reader`) without a reload,
    # and a refresh would re-load the relationship via its lazy loader → async
    # MissingGreenlet (RIL async migration).
    post = await db.get(models.Post, comment.post_id)
    parent = await db.get(models.Comment, comment.parent_id) if comment.parent_id is not None else None

    # An approved REPLY notifies the replied-to reader (its author is not
    # notified). (DEC-064, TASK-137). A deactivated reader gets no notification —
    # deactivation silences every channel, reply pushes included (DEC-194,
    # RIL ISS-278).
    if parent is not None and parent.reader_id is not None and parent.reader_id != comment.reader_id:
        parent_reader = await db.get(auth.ReaderAccount, parent.reader_id)
        if post is not None and parent_reader is not None and parent_reader.is_active:
            await _notify_replied_to(parent_reader, post, comment.id, db, commenter_id=comment.reader_id)

    # Guest reply-email (DEC-332, TASK-392): an approved REPLY to an anonymous
    # comment that consented emails the guest, independent of the reader
    # fan-out above (which only ever sees reader-attributed parents).
    if post is not None and parent is not None:
        await _maybe_notify_guest_replied_to(parent, comment, post)

    # Any approved comment notifies the thread's followers (DEC-078), excluding
    # the comment's own author and — on a reply — the replied-to reader, who
    # already got the targeted notification above (no double push).
    if post is not None:
        excluded: set[int] = set()
        if comment.reader_id is not None:
            excluded.add(comment.reader_id)
        if parent is not None and parent.reader_id is not None:
            excluded.add(parent.reader_id)
        await _notify_thread_subscribers(post, comment.id, excluded, db, commenter_id=comment.reader_id)
        # Guest thread-follow (DEC-427, TASK-438): email this post's confirmed
        # guest subscribers. Independent of the reader fan-out above — different
        # rows, no account, straight SMTP.
        await _notify_guest_thread_subscribers(post, comment, db)

    # @-mention fan-out (DEC-322, TASK-389): an approved comment naming a
    # reader's display name (e.g. "@Riki") notifies them with a deep link to the
    # comment. Best-effort like the reply/thread fan-out; a comment still
    # pending notifies nobody (moderation gate).
    if post is not None and comment.content and "@" in comment.content:
        mentioned_ids = await resolve_mention_reader_ids(db, comment.content)
        if mentioned_ids:
            await _notify_mentions(post, comment, mentioned_ids, db)

    # Reader-to-reader follow fan-out (round 365, DEC-403): an approved comment
    # from a reader notifies everyone following that READER (the person-shaped
    # axis of the follow wheel — distinct from the thread followers above,
    # whose subscription is to the POST). The commenter cannot follow themself
    # (enforced at follow time), so no self-exclusion is needed beyond the
    # replied-to reader already notified above — skip them to avoid a double
    # push when the parent reader also follows the commenter.
    if post is not None and comment.reader_id is not None:
        await _notify_reader_followers(post, comment, db)

    # Guest manage email (round 385, DEC-435/TASK-444): an approved ANONYMOUS
    # comment that consented to email gets a "your comment is live — manage it"
    # message with the deep link to its token-gated manage page. The token only
    # ever exists for consenting guests (DEC-332), so the send set is exactly
    # the guests already receiving mail; best-effort like every fan-out.
    if post is not None:
        await _maybe_email_guest_manage_link(comment, post)


async def _maybe_email_guest_manage_link(comment: models.Comment, post: models.Post) -> None:
    """Best-effort approval-time manage email to an ANONYMOUS commenter.

    Fires when a guest's own comment is approved (the moment it becomes
    permanent on a moderated blog) and that guest has an email + management
    token. A guest has no account, so the emailed deep link is the ONLY way
    they can reach the token-gated manage endpoint (round 385) — and since the
    token is delivered exclusively by mail, possession of the link proves the
    commenter (or an address they control) holds it, mirroring the DEC-332
    reply-email argument. Never raises (best effort, like every fan-out): a mail
    failure must not break the approval that fired it.
    """
    # Only anonymous parents that consented AND have an address qualify — the
    # token is set exclusively on such rows at create time (DEC-332).
    if comment.reader_id is not None or not comment.email or comment.reply_notify_token is None:
        return
    if not is_email_configured():
        return
    try:
        send_guest_comment_manage_email(
            comment.email,
            post_title=post.title or "",
            post_url=f"/posts/{post.slug}#comment-{comment.id}",
            # Flat top-level route (DEC-435/TASK-444): a child under /comments
            # would nest under the /comments page and never mount (Nuxt
            # page-nesting gotcha, per DEC-332's /comment-reply-unsubscribe).
            manage_url=f"/comment-manage?token={comment.reply_notify_token}",
        )
    except Exception:  # noqa: BLE001 — best effort, never fail the approval
        logger.exception("guest comment manage-email dispatch failed")


async def _notify_reader_followers(post: models.Post, comment: models.Comment, db: AsyncSession) -> None:
    """Inbox 'reader you follow commented' fan-out (round 365, DEC-403).

    Followers of the COMMENT's reader (not the thread's subscribers — that is
    the separate post-shaped fan-out above) learn the commenter said something
    new. Best-effort like every fan-out: never fails the approving write, syncs
    only the durable inbox (a browser push for this social gesture is a
    follow-up, like email for thread news). The replied-to reader is excluded
    when the comment is a reply — they already got the targeted reply
    notification above, and a double push for the same comment is noise.
    """
    try:
        target_ids = await list_reader_follower_ids(db, comment.reader_id or 0)
        if not target_ids:
            return
        if comment.parent_id is not None:
            parent = await db.get(models.Comment, comment.parent_id)
            if parent is not None and parent.reader_id is not None:
                target_ids = [rid for rid in target_ids if rid != parent.reader_id]
        if not target_ids:
            return
        # Deactivation silences every channel (DEC-194) and the per-kind opt-out
        # (DEC-171) applies to this kind like any other: reader_comment is a
        # NOTIFICATION_KINDS member with its own ReaderNotificationPref column
        # (round 365), so an opted-out follower is dropped here — and a missing
        # pref row reads enabled.
        # Reader-block opt-out (DEC-425, TASK-437): a follower who blocked the
        # commenter drops out — blocking is a receiver-side opt-out, so a
        # blocked commenter's activity is invisible to them even if they still
        # follow. Suppressed before the active/prefs filters to keep one pass.
        if comment.reader_id is not None:
            blocked = await readers_who_block(db, comment.reader_id, target_ids)
            if blocked:
                target_ids = [rid for rid in target_ids if rid not in blocked]
        active_rows = (
            await db.execute(
                select(auth.ReaderAccount.id).filter(
                    auth.ReaderAccount.id.in_(target_ids),
                    auth.ReaderAccount.is_active.is_(True),
                )
            )
        ).all()
        active_ids = {rid for (rid,) in active_rows}
        prefs = await reader_notification_prefs_for(db, target_ids)
        target_ids = [
            rid
            for rid in target_ids
            if rid in active_ids and notification_kind_enabled(prefs.get(rid), "reader_comment")
        ]
        if not target_ids:
            return
        commenter = await db.get(auth.ReaderAccount, comment.reader_id)
        who = commenter.display_name if commenter is not None and commenter.display_name else "Reader"
        await record_reader_follow_notifications(
            db,
            target_ids,
            commenter=who,
            post_title=post.title or "",
            url=f"/posts/{post.slug}#comment-{comment.id}",
        )
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        # Log, never rollback: record_reader_follow_notifications is itself
        # best-effort (it swallows its own errors), so anything reaching here is
        # a query-level surprise — and a Session.rollback() here would expire
        # the just-approved Comment mid-request and 500 the approval (the other
        # fan-out helpers log-without-rollback for the same reason; the session
        # dies at request end anyway, so no partial rows leak).
        logger.exception("reader-follow comment fan-out failed")


async def _notify_mentions(
    post: models.Post,
    comment: models.Comment,
    mentioned_ids: list[int],
    db: AsyncSession,
) -> None:
    """Notify each reader @-mentioned in an approved comment (DEC-322).

    Excludes the commenter (a reader can't meaningfully mention themselves),
    skips deactivated readers (deactivation silences every channel, DEC-194 /
    RIL ISS-278), and drops readers who switched the 'mention' kind off
    (DEC-171). Writes the durable inbox row and, independently, the email copy
    for readers who opted into email_mention (DEC-326) — the two channels are
    gated by different prefs, so an inbox opt-out does not mute the email and
    vice versa. Best effort: never raises, so approval can't fail on
    notifications.
    """
    if comment.reader_id is not None:
        mentioned_ids = [rid for rid in mentioned_ids if rid != comment.reader_id]
    if not mentioned_ids:
        return
    active_rows = (
        await db.execute(
            select(auth.ReaderAccount.id).filter(
                auth.ReaderAccount.id.in_(mentioned_ids),
                auth.ReaderAccount.is_active.is_(True),
            )
        )
    ).all()
    active_ids = {rid for (rid,) in active_rows}
    target_ids = [rid for rid in mentioned_ids if rid in active_ids]
    # Reader-block opt-out (DEC-425, TASK-437): a mentioned reader who blocked
    # the commenter hears nothing — an @-mention by an abusive reader is the
    # exact channel a block exists to silence. Dropped before the prefs split
    # so neither the inbox nor the email copy is written.
    if comment.reader_id is not None:
        blocked = await readers_who_block(db, comment.reader_id, target_ids)
        if blocked:
            target_ids = [rid for rid in target_ids if rid not in blocked]
    target_prefs = await reader_notification_prefs_for(db, target_ids)
    # The two channels are gated by DIFFERENT prefs (DEC-326): a reader may
    # silence the in-app 'mention' kind yet still want the email copy, or vice
    # versa — an inbox opt-out must not mute an explicitly-opted email.
    inbox_ids = [rid for rid in target_ids if notification_kind_enabled(target_prefs.get(rid), "mention")]
    email_ids = [rid for rid in target_ids if email_channel_enabled(target_prefs.get(rid), "mention")]
    if not inbox_ids and not email_ids:
        return

    # The commenter's label for the body: their verified display name when they
    # commented as a reader, else their typed nickname, else a generic label.
    commenter_label = "Reader"
    if comment.reader_id is not None:
        author = await db.get(auth.ReaderAccount, comment.reader_id)
        if author is not None and author.display_name:
            commenter_label = author.display_name
        elif comment.nickname:
            commenter_label = comment.nickname
    elif comment.nickname:
        commenter_label = comment.nickname
    url = f"/posts/{post.slug}#comment-{comment.id}"
    if inbox_ids:
        await record_mention_notifications(
            db,
            inbox_ids,
            # DEC-321 anchor: the landing machinery scrolls to the exact comment.
            post_title=post.title or "",
            commenter=commenter_label,
            url=url,
        )
    # Email copy (DEC-326, TASK-391): same values as the inbox row so both
    # channels agree — localized per reader (DEC-340/TASK-396). One locale
    # query for the whole email target set, then per-reader copy.
    email_locales = await reader_locale_map(db, email_ids)
    if email_ids:
        await dispatch_notification_emails(
            db,
            [
                EmailItem(
                    rid,
                    "mention",
                    *notification_copy(
                        "mention",
                        post.title or "",
                        email_locales.get(rid),
                        commenter=commenter_label,
                    ),
                    url,
                )
                for rid in email_ids
            ],
            logger,
        )
