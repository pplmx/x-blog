import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.auth import User, get_current_admin
from app.database import get_db
from app.emailer import EmailItem, dispatch_notification_emails, email_channel_enabled
from app.limiter import RATE_LIMIT_COMMENT, RATE_LIMIT_READ, client_rate_key, limiter
from app.middleware import get_logger
from app.webpush import (
    dispatch_moderation_pending,
    dispatch_to_subscriptions,
    vapid_configured,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/comments", tags=["comments"])

# Reply-notification copy (server-generated push, so not i18n-able per browser;
# operators can localize via env). Defaults match the site's zh-first posture.
REPLY_NOTIF_TITLE = os.getenv("REPLY_NOTIFICATION_TITLE", "有人回复了你的评论")
REPLY_NOTIF_BODY = os.getenv("REPLY_NOTIFICATION_BODY", "《{post_title}》有新回复")

# Thread-follow notification copy (DEC-078/TASK-150): a new comment was
# approved on a thread the reader follows.
THREAD_NOTIF_TITLE = os.getenv("THREAD_NOTIFICATION_TITLE", "你订阅的讨论有新评论")
THREAD_NOTIF_BODY = os.getenv("THREAD_NOTIFICATION_BODY", "《{post_title}》有新评论")


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
) -> None:
    """Push 'a new comment was approved on a thread you follow' to followers.

    Fired when any comment is approved (this blog moderates every comment:
    followers should only hear about comments they can actually see). Target:
    every reader following the post's thread minus ``exclude_reader_ids`` —
    the comment's own author (no self-notification) and, for a reply, the
    replied-to reader (they already get the targeted reply notification,
    DEC-064; doubling it would push twice). Best effort: VAPID unconfigured
    or no subscribers is a silent no-op — moderation must never fail because
    of notifications. Dead (404/410) subscriptions are retired by the shared
    dispatch helper. (DEC-078, TASK-150)
    """
    target_ids = [rid for rid in crud.comment_subscription_reader_ids(db, post.id) if rid not in exclude_reader_ids]
    # Per-kind opt-out (DEC-171, TASK-202): readers who turned 'thread_comment'
    # off are dropped before both the inbox row and the push fan-out below.
    target_prefs = crud.reader_notification_prefs_for(db, target_ids)
    target_ids = [rid for rid in target_ids if crud.notification_kind_enabled(target_prefs.get(rid), "thread_comment")]
    if not target_ids:
        return
    # Persist to the durable reader inbox (independent of VAPID) so a reader
    # sees the new comment in-app even if the browser push is missed/unconfigured.
    for rid in target_ids:
        crud.record_reader_notification(
            db,
            rid,
            kind="thread_comment",
            title=THREAD_NOTIF_TITLE,
            body=THREAD_NOTIF_BODY.replace("{post_title}", post.title or ""),
            url=f"/posts/{post.slug}#comment-{new_comment_id}",
        )
    # Email channel (DEC-197, TASK-217): best-effort off-site copy for thread
    # followers who opted into email for the kind.
    dispatch_notification_emails(
        db,
        [
            EmailItem(
                rid,
                "thread_comment",
                THREAD_NOTIF_TITLE,
                THREAD_NOTIF_BODY.replace("{post_title}", post.title or ""),
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


def _notify_replied_to(
    parent_reader: auth.ReaderAccount,
    post: models.Post,
    parent_comment_id: int,
    db: Session,
) -> None:
    """Push 'someone replied to your comment' to the replied-to reader.

    Fired when a *reply is approved* (this blog moderates every comment, DEC-064:
    a reader should only hear about a reply they can actually see — notifying at
    create-time would leak pending/spam replies). Target: the parent comment's
    author if they are a reader with a push subscription. Best effort: VAPID
    unconfigured or missing subscriptions is a silent no-op — moderation must
    never fail because of notifications. Dead (404/410) subscriptions are retired
    via the shared dispatch helper. (DEC-064, TASK-137; DEC-072, TASK-145)
    """
    # Per-kind opt-out (DEC-171, TASK-202): a replied-to reader who turned
    # 'reply' off gets neither the inbox row nor the push.
    target_prefs = crud.reader_notification_prefs_for(db, [parent_reader.id])
    if not crud.notification_kind_enabled(target_prefs.get(parent_reader.id), "reply"):
        return
    # Persist to the durable reader inbox (independent of VAPID) so the replied-to
    # reader sees the reply in-app even if the browser push is missed/unconfigured.
    crud.record_reader_notification(
        db,
        parent_reader.id,
        kind="reply",
        title=REPLY_NOTIF_TITLE,
        body=REPLY_NOTIF_BODY.replace("{post_title}", post.title or ""),
        url=f"/posts/{post.slug}#comment-{parent_comment_id}",
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
                    REPLY_NOTIF_TITLE,
                    REPLY_NOTIF_BODY.replace("{post_title}", post.title or ""),
                    f"/posts/{post.slug}#comment-{parent_comment_id}",
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
        "url": f"/posts/{post.slug}#comment-{parent_comment_id}",
    }
    subs = db.query(models.PushSubscription).filter(models.PushSubscription.reader_id == parent_reader.id).all()
    if subs:
        dispatch_to_subscriptions(subs, payload, db, logger)


def _notify_comment_approved(db: Session, comment: models.Comment) -> None:
    """Fire the notifications for a comment that just became public.

    Shared by the admin approve endpoint and the verified-reader auto-approve
    path (DEC-098, TASK-161): a reply notifies the replied-to reader, then the
    thread's followers. Best-effort — never fails the approve, mirroring the
    existing approve_comment guarantees (DEC-064/072/078).
    """
    post = db.get(models.Post, comment.post_id)
    parent = db.get(models.Comment, comment.parent_id) if comment.parent_id is not None else None

    # An approved REPLY notifies the replied-to reader (its author is not
    # notified). (DEC-064, TASK-137)
    if parent is not None and parent.reader_id is not None and parent.reader_id != comment.reader_id:
        parent_reader = db.get(auth.ReaderAccount, parent.reader_id)
        if post is not None and parent_reader is not None:
            _notify_replied_to(parent_reader, post, parent.id, db)

    # Any approved comment notifies the thread's followers (DEC-078), excluding
    # the comment's own author and — on a reply — the replied-to reader, who
    # already got the targeted notification above (no double push).
    if post is not None:
        excluded: set[int] = set()
        if comment.reader_id is not None:
            excluded.add(comment.reader_id)
        if parent is not None and parent.reader_id is not None:
            excluded.add(parent.reader_id)
        _notify_thread_subscribers(post, comment.id, excluded, db)


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


@router.get("/post/{post_id}", response_model=CommentListResponse)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def list_comments(
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    post_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("newest", description="newest | oldest | likes"),
    db: Session = Depends(get_db),
):
    """Get paginated approved comments for a post.

    ``sort`` lets readers reorder the thread — newest (default), oldest, or
    most helpful (likes desc). Invalid values are rejected like the search
    sort (DEC-094, TASK-159). The post must exist and be publicly visible:
    drafts/scheduled posts are 404 (same gate as create/like), so a now-draft
    post's previously approved comments are not served and the endpoint is not
    a draft-existence oracle (ISS-144).
    """
    if sort not in VALID_COMMENT_SORTS:
        raise HTTPException(status_code=422, detail=f"sort must be one of {list(VALID_COMMENT_SORTS)}")
    post = db.get(models.Post, post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    comments, total = crud.get_comments_paginated(db, post_id, page=page, limit=limit, sort=sort)
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
    post_id: int,
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
    comment_id: int,
    approval: CommentApproval,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Approve or reject a comment. Admin only."""
    comment = crud.approve_comment(db, comment_id, approved=approval.approved)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if approval.approved:
        # Shared with the verified-reader auto-approve path (DEC-098, TASK-161).
        _notify_comment_approved(db, comment)
    return comment


@router.post("/{comment_id}/like", response_model=schemas.CommentPublic)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def like_comment(
    request: Request,  # noqa: ARG001
    comment_id: int,
    db: Session = Depends(get_db),
):
    """Increment the like count for a comment (DEC-092, TASK-158).

    Anonymous count++, mirroring POST /posts/{id}/like (the frontend guards
    a visitor to one like per comment via localStorage). A comment on a draft
    or otherwise non-public post responds 404 — the same as an unknown id —
    so the endpoint never answers existence questions about drafts.
    """
    comment = db.get(models.Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    post = db.get(models.Post, comment.post_id)
    if not post or not crud.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Comment not found")
    updated = crud.increment_comment_likes(db, comment_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
    return updated


class CommentFlagBody(BaseModel):
    """Optional reason when a reader flags a comment for moderation (DEC-108)."""

    reason: str | None = Field(default=None, max_length=200)


@router.post("/{comment_id}/flag")
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
def flag_comment(
    request: Request,  # noqa: ARG001
    response: Response,
    comment_id: int,
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
    comment_id: int,
    _current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        success = crud.delete_comment(db, comment_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found")
