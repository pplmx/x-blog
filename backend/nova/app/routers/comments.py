import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.auth import User, get_current_admin
from app.crud import (
    REPLY_NOTIF_BODY,
    REPLY_NOTIF_TITLE,
    THREAD_NOTIF_BODY,
    THREAD_NOTIF_TITLE,
    notification_copy,
    utc_now_naive,
)
from app.database import get_db
from app.emailer import (
    EmailItem,
    dispatch_notification_emails,
    email_channel_enabled,
    is_email_configured,
    send_guest_comment_manage_email,
    send_guest_reply_email,
    send_guest_thread_email,
)
from app.limiter import RATE_LIMIT_COMMENT, RATE_LIMIT_READ, client_rate_key, limiter
from app.middleware import get_logger
from app.schemas import IdInt, NonNulStr, PageInt
from app.webpush import (
    dispatch_moderation_pending,
    dispatch_to_subscriptions,
    vapid_configured,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/comments", tags=["comments"])

# Longest allowed search/keyword term (shared with the /search router; the
# thread-scoped q on list_comments uses the same boundary, DEC-442).
MAX_QUERY_LENGTH = 200

# Reply-ish notification copy now lives in crud (notification_copy, DEC-340/
# TASK-396) so the durable inbox rows + emails localize per reader; the env-
# overridable zh constants are IMPORTED from there. The constants below remain
# for the server-generated PUSH payloads only (a single push payload can't
# vary per reader browser, and operators keep localizing via env).


# Sort orders accepted by GET /api/comments/post/{id} (DEC-094, TASK-159).
# "newest" is the default (created_at desc); "oldest" is created_at asc; "likes"
# is likes desc with a created_at desc tiebreak so equal counts stay deterministic.
VALID_COMMENT_SORTS = ("newest", "oldest", "likes")


# Moderation trust tier (DEC-098, TASK-161): when enabled, a comment authored by
# a verified reader account (reader_id stamped from the reader JWT at create,
# DEC-062) is approved immediately instead of waiting for a moderator, while
# anonymous comments stay fully moderated. Operator-controlled env toggle;
# default off preserves the "every comment is moderated" stance (DEC-066).
def _env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


AUTO_APPROVE_READER_COMMENTS = _env_flag("AUTO_APPROVE_READER_COMMENTS")


def _notify_thread_subscribers(
    post: models.Post,
    new_comment_id: int,
    exclude_reader_ids: set[int],
    db: Session,
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
    target_ids = [rid for rid in crud.comment_subscription_reader_ids(db, post.id) if rid not in exclude_reader_ids]
    if commenter_id is not None:
        blocked = crud.readers_who_block(db, commenter_id, target_ids)
        if blocked:
            target_ids = [rid for rid in target_ids if rid not in blocked]
    # Deactivation silences every channel (DEC-194, RIL ISS-278): a deactivated
    # reader keeps their thread subscription row, but must not get the inbox
    # push below (their email is already filtered in dispatch_notification_emails).
    if target_ids:
        active_ids = {
            rid
            for (rid,) in db.query(auth.ReaderAccount.id)
            .filter(
                auth.ReaderAccount.id.in_(target_ids),
                auth.ReaderAccount.is_active.is_(True),
            )
            .all()
        }
        target_ids = [rid for rid in target_ids if rid in active_ids]
    # Per-kind opt-out (DEC-171, TASK-202): readers who turned 'thread_comment'
    # off are dropped before both the inbox row and the push fan-out below.
    target_prefs = crud.reader_notification_prefs_for(db, target_ids)
    target_ids = [rid for rid in target_ids if crud.notification_kind_enabled(target_prefs.get(rid), "thread_comment")]
    if not target_ids:
        return
    # Persist to the durable reader inbox (independent of VAPID) so a reader
    # sees the new comment in-app even if the browser push is missed/unconfigured.
    # Batched (ISS-427): build every follower's row, flush + prune + commit once
    # — the old per-follower record_reader_notification loop paid O(2n) queries
    # and N transactions per approved comment on a big thread.
    crud.record_thread_comment_notifications(
        db,
        target_ids,
        post_title=post.title or "",
        url=f"/posts/{post.slug}#comment-{new_comment_id}",
    )
    # Email channel (DEC-197, TASK-217): best-effort off-site copy for thread
    # followers who opted into email for the kind — localized per reader the
    # same way as the inbox rows (DEC-340/TASK-396). One locale query for the
    # whole target set, then per-reader copy.
    email_locales = crud.reader_locale_map(db, target_ids)
    dispatch_notification_emails(
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
    subscriptions = db.query(models.PushSubscription).filter(models.PushSubscription.reader_id.in_(target_ids)).all()
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
    dispatch_to_subscriptions(subscriptions, payload, db, logger)


def _notify_guest_thread_subscribers(
    post: models.Post,
    comment: models.Comment,
    db: Session,
) -> None:
    """Guest thread-follow fan-out (DEC-427, TASK-438): email every CONFIRMED
    guest subscriber of the post that a new comment is approved.

    The anonymous counterpart of ``_notify_thread_subscribers`` — a guest
    subscription is keyed by (email, post) with no account, so this goes
    straight through the SMTP path (``send_guest_thread_email``, like the guest
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
    subscribers = crud.list_confirmed_guest_comment_subscribers(db, post.id)
    if not subscribers:
        return
    commenter_email = comment.email.strip().casefold() if comment.email else None
    if comment.reader_id is not None:
        account = db.get(auth.ReaderAccount, comment.reader_id)
        if account is not None and account.email:
            commenter_email = account.email.strip().casefold()
    url = f"/posts/{post.slug}#comment-{comment.id}"
    for sub in subscribers:
        if commenter_email and sub.email.strip().casefold() == commenter_email:
            continue
        try:
            send_guest_thread_email(
                sub.email,
                post_title=post.title or "",
                comment_url=url,
                unsubscribe_url=f"/comment-subscribe/unsubscribe?token={sub.token}",
            )
        except Exception:  # noqa: BLE001 — best effort, never fail the approval
            logger.exception("guest thread fan-out email failed for %s", sub.email)


def _notify_replied_to(
    parent_reader: auth.ReaderAccount,
    post: models.Post,
    reply_comment_id: int,
    db: Session,
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
    if commenter_id is not None and crud.get_reader_block(db, parent_reader.id, commenter_id):
        return
    # Per-kind opt-out (DEC-171, TASK-202): a replied-to reader who turned
    # 'reply' off gets neither the inbox row nor the push.
    target_prefs = crud.reader_notification_prefs_for(db, [parent_reader.id])
    if not crud.notification_kind_enabled(target_prefs.get(parent_reader.id), "reply"):
        return
    # Localized copy for THIS reader (DEC-340/TASK-396): the durable inbox row
    # and email both carry the reader's language; the push payload below stays
    # the server-global env copy (one payload per browser, not per reader).
    reply_title, reply_body = notification_copy("reply", post.title or "", parent_reader.locale)
    # Persist to the durable reader inbox (independent of VAPID) so the replied-to
    # reader sees the reply in-app even if the browser push is missed/unconfigured.
    crud.record_reader_notification(
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
        dispatch_notification_emails(
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
    subs = db.query(models.PushSubscription).filter(models.PushSubscription.reader_id == parent_reader.id).all()
    if subs:
        dispatch_to_subscriptions(subs, payload, db, logger)


def _maybe_notify_guest_replied_to(
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


def _notify_comment_approved(db: Session, comment: models.Comment) -> None:
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
    db.commit()
    db.refresh(comment)
    post = db.get(models.Post, comment.post_id)
    parent = db.get(models.Comment, comment.parent_id) if comment.parent_id is not None else None

    # An approved REPLY notifies the replied-to reader (its author is not
    # notified). (DEC-064, TASK-137). A deactivated reader gets no notification —
    # deactivation silences every channel, reply pushes included (DEC-194,
    # RIL ISS-278).
    if parent is not None and parent.reader_id is not None and parent.reader_id != comment.reader_id:
        parent_reader = db.get(auth.ReaderAccount, parent.reader_id)
        if post is not None and parent_reader is not None and parent_reader.is_active:
            _notify_replied_to(parent_reader, post, comment.id, db, commenter_id=comment.reader_id)

    # Guest reply-email (DEC-332, TASK-392): an approved REPLY to an anonymous
    # comment that consented emails the guest, independent of the reader
    # fan-out above (which only ever sees reader-attributed parents).
    if post is not None and parent is not None:
        _maybe_notify_guest_replied_to(parent, comment, post)

    # Any approved comment notifies the thread's followers (DEC-078), excluding
    # the comment's own author and — on a reply — the replied-to reader, who
    # already got the targeted notification above (no double push).
    if post is not None:
        excluded: set[int] = set()
        if comment.reader_id is not None:
            excluded.add(comment.reader_id)
        if parent is not None and parent.reader_id is not None:
            excluded.add(parent.reader_id)
        _notify_thread_subscribers(post, comment.id, excluded, db, commenter_id=comment.reader_id)
        # Guest thread-follow (DEC-427, TASK-438): email this post's confirmed
        # guest subscribers. Independent of the reader fan-out above — different
        # rows, no account, straight SMTP.
        _notify_guest_thread_subscribers(post, comment, db)

    # @-mention fan-out (DEC-322, TASK-389): an approved comment naming a
    # reader's display name (e.g. "@Riki") notifies them with a deep link to the
    # comment. Best-effort like the reply/thread fan-out; a comment still
    # pending notifies nobody (moderation gate).
    if post is not None and comment.content and "@" in comment.content:
        mentioned_ids = crud.resolve_mention_reader_ids(db, comment.content)
        if mentioned_ids:
            _notify_mentions(post, comment, mentioned_ids, db)

    # Reader-to-reader follow fan-out (round 365, DEC-403): an approved comment
    # from a reader notifies everyone following that READER (the person-shaped
    # axis of the follow wheel — distinct from the thread followers above,
    # whose subscription is to the POST). The commenter cannot follow themself
    # (enforced at follow time), so no self-exclusion is needed beyond the
    # replied-to reader already notified above — skip them to avoid a double
    # push when the parent reader also follows the commenter.
    if post is not None and comment.reader_id is not None:
        _notify_reader_followers(post, comment, db)

    # Guest manage email (round 385, DEC-435/TASK-444): an approved ANONYMOUS
    # comment that consented to email gets a "your comment is live — manage it"
    # message with the deep link to its token-gated manage page. The token only
    # ever exists for consenting guests (DEC-332), so the send set is exactly
    # the guests already receiving mail; best-effort like every fan-out.
    if post is not None:
        _maybe_email_guest_manage_link(comment, post)


def _maybe_email_guest_manage_link(comment: models.Comment, post: models.Post) -> None:
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


def _notify_reader_followers(post: models.Post, comment: models.Comment, db: Session) -> None:
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
        target_ids = crud.list_reader_follower_ids(db, comment.reader_id or 0)
        if not target_ids:
            return
        if comment.parent_id is not None:
            parent = db.get(models.Comment, comment.parent_id)
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
            blocked = crud.readers_who_block(db, comment.reader_id, target_ids)
            if blocked:
                target_ids = [rid for rid in target_ids if rid not in blocked]
        active_ids = {
            rid
            for (rid,) in db.query(auth.ReaderAccount.id)
            .filter(auth.ReaderAccount.id.in_(target_ids), auth.ReaderAccount.is_active.is_(True))
            .all()
        }
        prefs = crud.reader_notification_prefs_for(db, target_ids)
        target_ids = [
            rid
            for rid in target_ids
            if rid in active_ids and crud.notification_kind_enabled(prefs.get(rid), "reader_comment")
        ]
        if not target_ids:
            return
        commenter = db.get(auth.ReaderAccount, comment.reader_id)
        who = commenter.display_name if commenter is not None and commenter.display_name else "Reader"
        crud.record_reader_follow_notifications(
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


def _notify_mentions(
    post: models.Post,
    comment: models.Comment,
    mentioned_ids: list[int],
    db: Session,
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
    active_ids = {
        rid
        for (rid,) in db.query(auth.ReaderAccount.id)
        .filter(
            auth.ReaderAccount.id.in_(mentioned_ids),
            auth.ReaderAccount.is_active.is_(True),
        )
        .all()
    }
    target_ids = [rid for rid in mentioned_ids if rid in active_ids]
    # Reader-block opt-out (DEC-425, TASK-437): a mentioned reader who blocked
    # the commenter hears nothing — an @-mention by an abusive reader is the
    # exact channel a block exists to silence. Dropped before the prefs split
    # so neither the inbox nor the email copy is written.
    if comment.reader_id is not None:
        blocked = crud.readers_who_block(db, comment.reader_id, target_ids)
        if blocked:
            target_ids = [rid for rid in target_ids if rid not in blocked]
    target_prefs = crud.reader_notification_prefs_for(db, target_ids)
    # The two channels are gated by DIFFERENT prefs (DEC-326): a reader may
    # silence the in-app 'mention' kind yet still want the email copy, or vice
    # versa — an inbox opt-out must not mute an explicitly-opted email.
    inbox_ids = [rid for rid in target_ids if crud.notification_kind_enabled(target_prefs.get(rid), "mention")]
    email_ids = [rid for rid in target_ids if email_channel_enabled(target_prefs.get(rid), "mention")]
    if not inbox_ids and not email_ids:
        return

    # The commenter's label for the body: their verified display name when they
    # commented as a reader, else their typed nickname, else a generic label.
    commenter_label = "Reader"
    if comment.reader_id is not None:
        author = db.get(auth.ReaderAccount, comment.reader_id)
        if author is not None and author.display_name:
            commenter_label = author.display_name
        elif comment.nickname:
            commenter_label = comment.nickname
    elif comment.nickname:
        commenter_label = comment.nickname
    url = f"/posts/{post.slug}#comment-{comment.id}"
    if inbox_ids:
        crud.record_mention_notifications(
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
    email_locales = crud.reader_locale_map(db, email_ids)
    if email_ids:
        dispatch_notification_emails(
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


class CommentListResponse(BaseModel):
    """Paginated comment list response (public — omits commenter PII)."""

    items: list[schemas.CommentPublic]
    total: int
    page: int
    limit: int
    total_pages: int


class CommentApproval(BaseModel):
    """Comment approval request."""

    approved: bool


class DiscussionFeedItem(schemas.CommentPublic):
    """One comment on the site-wide discussion feed (round 367, DEC-407).

    The public comment shape plus the post it was left on — the feed card
    deep-links onto the exact comment (``#comment-{id}``, DEC-321) via the
    post brief, never just the post headline.
    """

    post: schemas.CommentPostBrief | None = None


class DiscussionFeedPagination(BaseModel):
    total: int
    page: int
    limit: int
    total_pages: int


class DiscussionFeedResponse(BaseModel):
    items: list[DiscussionFeedItem]
    pagination: DiscussionFeedPagination


@router.get("/feed", response_model=DiscussionFeedResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def discussion_feed(
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Site-wide discussion feed (round 367, DEC-407).

    Search (DEC-405) made the discussion FINDABLE; this makes it BROWSABLE — a
    visitor who wants to see what people are saying right now has no surface
    otherwise. Newest approved comments on publicly-visible posts, each with
    the commenter identity (CommentPublic — emitted through CommentReaderProfile,
    never email/ip), the content, and the post brief so the card can land the
    reader ON the comment. Same visibility gate as comment search: pending/
    rejected comments and comments on draft/scheduled posts never appear.
    """
    comments, total = crud.list_public_comment_feed(db, page=page, limit=limit)
    total_pages = (total + limit - 1) // limit if limit > 0 else 0
    items = []
    for c in comments:
        base = schemas.CommentPublic.model_validate(c).model_dump()
        post = c.post  # joinedload in list_public_comment_feed
        items.append(
            DiscussionFeedItem(
                **base,
                post=(schemas.CommentPostBrief(id=post.id, title=post.title, slug=post.slug) if post else None),
            )
        )
    return DiscussionFeedResponse(
        items=items,
        pagination=DiscussionFeedPagination(
            total=total,
            page=page,
            limit=limit,
            total_pages=total_pages,
        ),
    )


@router.get("/post/{post_id}", response_model=CommentListResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def list_comments(
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    post_id: IdInt,
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("newest", description="newest | oldest | likes"),
    q: Annotated[NonNulStr | None, Query(max_length=MAX_QUERY_LENGTH)] = None,
    db: Session = Depends(get_db),
):
    """Get paginated approved comments for a post.

    ``sort`` lets readers reorder the thread — newest (default), oldest, or
    most helpful (likes desc). Invalid values are rejected like the search
    sort (DEC-094, TASK-159). The post must exist and be publicly visible:
    drafts/scheduled posts are 404 (same gate as create/like), so a now-draft
    post's previously approved comments are not served and the endpoint is not
    a draft-existence oracle (ISS-144).

    ``q`` (optional) narrows the thread to approved comments whose content
    contains every term — "search inside this thread" (DEC-442, TASK-452), the
    post-scoped answer to the global comment search. Length-bounded like every
    query surface; a whitespace-only q is rejected so it cannot degrade into a
    match-everything ILIKE.
    """
    if q is not None and not q.strip():
        raise HTTPException(status_code=422, detail="q must be a non-blank search term")
    if sort not in VALID_COMMENT_SORTS:
        raise HTTPException(status_code=422, detail=f"sort must be one of {list(VALID_COMMENT_SORTS)}")
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    comments, total = crud.get_comments_paginated(db, post_id, page=page, limit=limit, sort=sort, q=q or "")
    total_pages = (total + limit - 1) // limit if limit > 0 else 0

    return CommentListResponse(
        # Public endpoint: serialize CommentPublic (strips email/ip_address),
        # never the full Comment row (PII would otherwise ride the public list).
        items=[schemas.CommentPublic.model_validate(c) for c in comments],
        total=total,
        page=page,
        limit=limit,
        total_pages=total_pages,
    )


@router.post("/post/{post_id}", response_model=schemas.Comment, status_code=201)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def create_comment(
    post_id: IdInt,
    comment: schemas.CommentCreate,
    request: Request,
    db: Session = Depends(get_db),
    reader: auth.ReaderAccount | None = Depends(auth.get_optional_reader),
):
    # Drafts and not-yet-published scheduled posts are invisible to the public
    # (same rule as the read paths). Without this guard the endpoint became a
    # draft-existence oracle (201 here vs 400 "Post not found" for unknown ids)
    # and let visitors queue comments on drafts that surface once public.
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")

    # Per-post comment control (round 351): a closed post still renders its
    # existing comments (the conversation is part of the article) but refuses
    # new ones — the UI hides the form; this is the second line of defense for
    # stale clients / direct API callers. 403 keeps "you can read, you cannot
    # write" distinct from the 404 (unknown/invisible post).
    if not post.comments_enabled:
        raise HTTPException(status_code=403, detail="Comments are closed on this post")

    # Use the same proxy-aware resolver as the rate limiter so the stored IP
    # matches the bucket key (X-Forwarded-For behind a trusted proxy), instead
    # of the immediate TCP peer which every client behind the proxy would share.
    ip_address = client_rate_key(request)
    try:
        # Reply/thread notifications are fired at APPROVAL time (see
        # _notify_comment_approved), not here — comments are moderated. The
        # moderation alert is the exception: it fires at CREATE because the
        # whole point is telling the author a comment is WAITING for approval.
        # Best-effort — never fails the create. (DEC-080)
        created = crud.create_comment(db, post_id, comment, ip_address, reader=reader)

        # Moderation trust tier (DEC-098/100, TASK-161/162): when enabled, a
        # verified reader's comment (reader_id stamped from the reader JWT)
        # publishes immediately instead of waiting, firing the same approval
        # notifications as a moderator approve. The persisted admin setting
        # (if set) overrides the env fallback so the policy flips at runtime.
        # Anonymous comments and the flag-off case stay pending and go through
        # the moderator alert as before.
        if created.reader_id is not None and crud.boolean_setting(
            db, "auto_approve_reader_comments", AUTO_APPROVE_READER_COMMENTS
        ):
            approved = crud.approve_comment(db, created.id, approved=True)
            if approved is not None:
                _notify_comment_approved(db, approved)
                return approved

        dispatch_moderation_pending(db, post, created, logger)
        return created
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{comment_id}/approve", response_model=schemas.Comment)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def approve_comment(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    approval: CommentApproval,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Approve or reject a comment. Admin only. Idempotent: re-approving an
    already-approved comment (double click / retry) is a no-op that must not
    fan out duplicate reply + thread notifications (round-296 deep-dive)."""
    before = db.query(models.Comment.is_approved).filter(models.Comment.id == comment_id).scalar()
    comment = crud.approve_comment(db, comment_id, approved=approval.approved)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if approval.approved and not before:
        # Shared with the verified-reader auto-approve path (DEC-098, TASK-161).
        # crud.approve_comment resolved `before` from a real row (we are past
        # the 404), so `before` is the prior approval state; only a genuine
        # transition into approved fires the fan-out.
        _notify_comment_approved(db, comment)
    return comment


class ReplyNotifyUnsubscribeBody(BaseModel):
    """Unsubscribe token from a guest reply-email (DEC-332, TASK-392)."""

    token: str = Field(min_length=1, max_length=128)


@router.post("/reply-notify/unsubscribe", status_code=200)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def reply_notify_unsubscribe(
    request: Request,  # noqa: ARG001
    body: ReplyNotifyUnsubscribeBody,
    db: Session = Depends(get_db),
):
    """Flip a guest comment's reply-email consent off via its emailed token.

    ``reply_notify_token`` is the per-comment secret only the guest reply-email
    carries, so posting the right value proves the guest (or an address they
    control) holds the mail. Idempotent: a second post with an already-used
    token is a success (200), so an unsubscribe link can be clicked twice. An
    unknown token is 404 — indistinguishable from "already unsubscribed" for a
    random guess, so this never reveals which comments opted in.
    """
    comment = db.query(models.Comment).filter(models.Comment.reply_notify_token == body.token).first()
    if comment is None:
        raise HTTPException(status_code=404, detail="Invalid unsubscribe token")
    # The consent flips off; the token stays (a second click stays idempotent,
    # and unlistening once does not make a stale email link start 404ing).
    comment.reply_notify_email = False
    db.commit()
    return {"unsubscribed": True}


class CommentLikeBody(BaseModel):
    """Optional client-side marker for the like (unused by the server today)."""

    source: str | None = Field(default=None, max_length=50)


@router.post("/{comment_id}/like", response_model=schemas.CommentPublic)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def like_comment(
    request: Request,  # noqa: ARG001
    response: Response,
    comment_id: IdInt,
    db: Session = Depends(get_db),
    body: CommentLikeBody | None = None,
):
    """Increment the like count for a comment (DEC-092, TASK-158).

    Idempotent per (comment, source IP) like the flag path (security review):
    a second like from the same source is a no-op, so the count means distinct
    supporters rather than a client-guarded count++ an attacker could inflate
    to skew the "most helpful" ranking. The 201-vs-200 status tells the
    frontend whether this click registered a new like (mirrors flag). A comment
    on a draft or otherwise non-public post responds 404 — the same as an
    unknown id — so the endpoint never answers existence questions about drafts.
    """
    del body
    comment = db.get(models.Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    post = db.get(models.Post, comment.post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Comment not found")
    is_new, updated = crud.like_comment(db, comment_id, client_rate_key(request))
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
    response.status_code = status.HTTP_201_CREATED if is_new else status.HTTP_200_OK
    return updated


class CommentFlagBody(BaseModel):
    """Optional reason when a reader flags a comment for moderation (DEC-108)."""

    reason: str | None = Field(default=None, max_length=200)


class GuestCommentManageBody(BaseModel):
    """Manage-body for a guest's own comment (round 385, DEC-435/TASK-444).

    The token is the proof of authorship: it is the per-comment secret
    (DEC-332) delivered exclusively by mail (approval/reply emails), so
    possession of it demonstrates the address owns the comment. ``content``
    mirrors CommentCreate's gate (min_length=1 post-strip; max 5000).
    """

    token: Annotated[NonNulStr, Field(min_length=1, max_length=64)]
    content: Annotated[NonNulStr, Field(min_length=1, max_length=5000)] = ""

    @field_validator("content", mode="before")
    @classmethod
    def strip_content(cls, value: object) -> object:
        return schemas._strip_blank(value) if isinstance(value, str) else value


class GuestCommentManageResponse(BaseModel):
    """Manage-page payload: the comment plus minimal post context (round 385)."""

    comment: schemas.CommentPublic
    post: schemas.CommentPostBrief | None = None


@router.get("/manage", response_model=GuestCommentManageResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def get_guest_comment_manage(
    request: Request,  # noqa: ARG001
    token: str = Query(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
):
    """Load a guest's own comment for the management page (round 385).

    The token is the ownership proof (only the guest's email carries it), and
    an unknown token is a 404 so comment ids / tokens are not enumerable. The
    response carries the comment plus the post it sits on so the page can
    deep-link back to the thread. Moderation status rides on CommentPublic so
    the page can tell "pending / approved / rejected" apart.
    """
    comment = crud.get_guest_comment_by_token(db, token)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    post_obj = db.get(models.Post, comment.post_id)
    post_brief = (
        schemas.CommentPostBrief(id=post_obj.id, title=post_obj.title or "", slug=post_obj.slug)
        if post_obj is not None
        else None
    )
    return GuestCommentManageResponse(comment=comment, post=post_brief)


@router.patch("/manage", response_model=schemas.CommentPublic)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def edit_guest_comment_manage(
    request: Request,  # noqa: ARG001
    body: GuestCommentManageBody,
    db: Session = Depends(get_db),
):
    """Edit a guest's own comment via its management token (round 385).

    Same ownership semantics as the reader edit (DEC-096): only ``content`` may
    change, the body is stored raw and re-rendered through the sanitized
    markdown pipeline, ``edited_at`` is stamped, and the edit resets approval
    — an approved comment whose text was replaced re-enters the moderation
    queue rather than silently republishing author-supplied content over a
    moderator-approved body (no auto-approve tier exists for anonymous
    commenters, so it stays pending until a moderator reviews it). An unknown
    token is a 404, indistinguishable from a non-existent comment.
    """
    updated, _was_public = crud.update_guest_comment(db, body.token, body.content.strip() if body.content else "")
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
    # No moderation alert on edit — exactly like the reader path (DEC-096): the
    # reset comment shows as pending in the admin queue, and an alert on every
    # edit would let a guest spam moderators by toggling their own comment.
    return updated


@router.delete("/manage", status_code=204)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def delete_guest_comment_manage(
    request: Request,  # noqa: ARG001
    token: str = Query(..., min_length=1, max_length=64),
    db: Session = Depends(get_db),
):
    """Delete a guest's own comment via its management token (round 385).

    Ownership-scoped exactly like the reader delete: an unknown token (or a
    token matching no comment) is a 404, so ids are not enumerable. Replies are
    reparented (crud.delete_guest_comment) so the thread stays coherent.
    """
    try:
        deleted = crud.delete_guest_comment(db, token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found")
    return Response(status_code=204)


@router.post("/{comment_id}/flag")
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def flag_comment(
    request: Request,  # noqa: ARG001
    response: Response,
    comment_id: IdInt,
    body: CommentFlagBody | None = None,
    db: Session = Depends(get_db),
):
    """Flag a comment for moderator review (DEC-108, TASK-166).

    Anonymous/reader, rate-limited, idempotent per (comment, source IP). A
    comment on a draft or otherwise non-public post responds 404 (same as an
    unknown id) so the endpoint never answers existence questions about drafts.
    Returns the distinct-flag count (not exposed on the public schema).
    """
    comment = db.get(models.Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    post = db.get(models.Post, comment.post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Comment not found")
    reason = (body.reason if body is not None else None) or None
    created, total = crud.flag_comment(db, comment_id, client_rate_key(request), reason=reason)
    response.status_code = 201 if created else 200
    return {"comment_id": comment_id, "flags": total, "is_new": created}


@router.delete("/{comment_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def delete_comment(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        success = crud.delete_comment(db, comment_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found")
