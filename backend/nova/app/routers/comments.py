import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import auth, crud, models, schemas
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_COMMENT, client_rate_key, limiter
from app.middleware import get_logger
from app.webpush import dispatch_to_subscriptions, vapid_configured

logger = get_logger(__name__)

router = APIRouter(prefix="/api/comments", tags=["comments"])

# Reply-notification copy (server-generated push, so not i18n-able per browser;
# operators can localize via env). Defaults match the site's zh-first posture.
REPLY_NOTIF_TITLE = os.getenv("REPLY_NOTIFICATION_TITLE", "有人回复了你的评论")
REPLY_NOTIF_BODY = os.getenv("REPLY_NOTIFICATION_BODY", "《{post_title}》有新回复")


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
    subs = (
        db.query(models.PushSubscription)
        .filter(models.PushSubscription.reader_id == parent_reader.id)
        .all()
    )
    if subs:
        dispatch_to_subscriptions(subs, payload, db, logger)


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
def list_comments(
    post_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Get paginated approved comments for a post."""
    comments, total = crud.get_comments_paginated(db, post_id, page=page, limit=limit)
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
        # Reply notifications are fired at APPROVAL time (see approve_comment and
        # _notify_replied_to), not here — every comment is moderated.
        return crud.create_comment(db, post_id, comment, ip_address, reader=reader)
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

    # An approved REPLY notifies the replied-to reader (their own reply's author
    # is not notified). Best-effort: never fails the approval. (DEC-064, TASK-137)
    if approval.approved and comment.parent_id is not None:
        parent = db.get(models.Comment, comment.parent_id)
        if (
            parent is not None
            and parent.reader_id is not None
            and parent.reader_id != comment.reader_id
        ):
            post = db.get(models.Post, comment.post_id)
            parent_reader = db.get(auth.ReaderAccount, parent.reader_id)
            if post is not None and parent_reader is not None:
                _notify_replied_to(parent_reader, post, parent.id, db)
    return comment


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
