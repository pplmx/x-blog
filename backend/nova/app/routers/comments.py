import os
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth, models, schemas
from app.auth import User, get_current_admin
from app.database import get_db
from app.limiter import RATE_LIMIT_COMMENT, RATE_LIMIT_READ, client_rate_key, limiter
from app.middleware import get_logger
from app.schemas import IdInt, NonNulStr, PageInt
from app.services import comments as comments_service
from app.services.comments import _notify_comment_approved
from app.webpush import (
    dispatch_moderation_pending,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/comments", tags=["comments"])

# Longest allowed search/keyword term (shared with the /search router; the
# thread-scoped q on list_comments uses the same boundary, DEC-442).
MAX_QUERY_LENGTH = 200

# Reply-ish notification copy now lives in repositories (notification_copy, DEC-340/
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
async def discussion_feed(
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
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
    comments, total = await comments_service.list_public_comment_feed(db, page=page, limit=limit)
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
async def list_comments(
    request: Request,  # noqa: ARG001 — keyed by the rate limiter (RATE_LIMIT_READ)
    post_id: IdInt,
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=100),
    sort: str = Query("newest", description="newest | oldest | likes"),
    q: Annotated[NonNulStr | None, Query(max_length=MAX_QUERY_LENGTH)] = None,
    db: AsyncSession = Depends(get_db),
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
    post = await db.get(models.Post, post_id)
    if not post or not comments_service.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Post not found")
    comments, total = await comments_service.get_comments_paginated(
        db, post_id, page=page, limit=limit, sort=sort, q=q or ""
    )
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
async def create_comment(
    post_id: IdInt,
    comment: schemas.CommentCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    reader: auth.ReaderAccount | None = Depends(auth.get_optional_reader),
):
    # Drafts and not-yet-published scheduled posts are invisible to the public
    # (same rule as the read paths). Without this guard the endpoint became a
    # draft-existence oracle (201 here vs 400 "Post not found" for unknown ids)
    # and let visitors queue comments on drafts that surface once public.
    post = await db.get(models.Post, post_id)
    if not post or not comments_service.is_publicly_visible(post):
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
        created = await comments_service.create_comment(db, post_id, comment, ip_address, reader=reader)

        # Moderation trust tier (DEC-098/100, TASK-161/162): when enabled, a
        # verified reader's comment (reader_id stamped from the reader JWT)
        # publishes immediately instead of waiting, firing the same approval
        # notifications as a moderator approve. The persisted admin setting
        # (if set) overrides the env fallback so the policy flips at runtime.
        # Anonymous comments and the flag-off case stay pending and go through
        # the moderator alert as before.
        if created.reader_id is not None and await comments_service.boolean_setting(
            db, "auto_approve_reader_comments", AUTO_APPROVE_READER_COMMENTS
        ):
            approved = await comments_service.approve_comment(db, created.id, approved=True)
            if approved is not None:
                await _notify_comment_approved(db, approved)
                return approved

        await dispatch_moderation_pending(db, post, created, logger)
        return created
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/{comment_id}/approve", response_model=schemas.Comment)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
async def approve_comment(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    approval: CommentApproval,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Approve or reject a comment. Admin only. Idempotent: re-approving an
    already-approved comment (double click / retry) is a no-op that must not
    fan out duplicate reply + thread notifications (round-296 deep-dive)."""
    before = (await db.execute(select(models.Comment.is_approved).filter(models.Comment.id == comment_id))).scalar()
    comment = await comments_service.approve_comment(db, comment_id, approved=approval.approved)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    if approval.approved and not before:
        # Shared with the verified-reader auto-approve path (DEC-098, TASK-161).
        # comments_service.approve_comment resolved `before` from a real row (we are past
        # the 404), so `before` is the prior approval state; only a genuine
        # transition into approved fires the fan-out.
        await _notify_comment_approved(db, comment)
    return comment


class ReplyNotifyUnsubscribeBody(BaseModel):
    """Unsubscribe token from a guest reply-email (DEC-332, TASK-392)."""

    token: str = Field(min_length=1, max_length=128)


@router.post("/reply-notify/unsubscribe", status_code=200)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
async def reply_notify_unsubscribe(
    request: Request,  # noqa: ARG001
    body: ReplyNotifyUnsubscribeBody,
    db: AsyncSession = Depends(get_db),
):
    """Flip a guest comment's reply-email consent off via its emailed token.

    ``reply_notify_token`` is the per-comment secret only the guest reply-email
    carries, so posting the right value proves the guest (or an address they
    control) holds the mail. Idempotent: a second post with an already-used
    token is a success (200), so an unsubscribe link can be clicked twice. An
    unknown token is 404 — indistinguishable from "already unsubscribed" for a
    random guess, so this never reveals which comments opted in.
    """
    comment = (
        (await db.execute(select(models.Comment).filter(models.Comment.reply_notify_token == body.token)))
        .scalars()
        .first()
    )
    if comment is None:
        raise HTTPException(status_code=404, detail="Invalid unsubscribe token")
    # The consent flips off; the token stays (a second click stays idempotent,
    # and unlistening once does not make a stale email link start 404ing).
    comment.reply_notify_email = False
    await db.commit()
    return {"unsubscribed": True}


class CommentLikeBody(BaseModel):
    """Optional client-side marker for the like (unused by the server today)."""

    source: str | None = Field(default=None, max_length=50)


@router.post("/{comment_id}/like", response_model=schemas.CommentPublic)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
async def like_comment(
    request: Request,  # noqa: ARG001
    response: Response,
    comment_id: IdInt,
    db: AsyncSession = Depends(get_db),
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
    comment = await db.get(models.Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    post = await db.get(models.Post, comment.post_id)
    if not post or not comments_service.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Comment not found")
    is_new, updated = await comments_service.like_comment(db, comment_id, client_rate_key(request))
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
async def get_guest_comment_manage(
    request: Request,  # noqa: ARG001
    token: str = Query(..., min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    """Load a guest's own comment for the management page (round 385).

    The token is the ownership proof (only the guest's email carries it), and
    an unknown token is a 404 so comment ids / tokens are not enumerable. The
    response carries the comment plus the post it sits on so the page can
    deep-link back to the thread. Moderation status rides on CommentPublic so
    the page can tell "pending / approved / rejected" apart.
    """
    comment = await comments_service.get_guest_comment_by_token(db, token)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    post_obj = await db.get(models.Post, comment.post_id)
    post_brief = (
        schemas.CommentPostBrief(id=post_obj.id, title=post_obj.title or "", slug=post_obj.slug)
        if post_obj is not None
        else None
    )
    return GuestCommentManageResponse(comment=comment, post=post_brief)


@router.patch("/manage", response_model=schemas.CommentPublic)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
async def edit_guest_comment_manage(
    request: Request,  # noqa: ARG001
    body: GuestCommentManageBody,
    db: AsyncSession = Depends(get_db),
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
    updated, _was_public = await comments_service.update_guest_comment(
        db, body.token, body.content.strip() if body.content else ""
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Comment not found")
    # No moderation alert on edit — exactly like the reader path (DEC-096): the
    # reset comment shows as pending in the admin queue, and an alert on every
    # edit would let a guest spam moderators by toggling their own comment.
    return updated


@router.delete("/manage", status_code=204)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
async def delete_guest_comment_manage(
    request: Request,  # noqa: ARG001
    token: str = Query(..., min_length=1, max_length=64),
    db: AsyncSession = Depends(get_db),
):
    """Delete a guest's own comment via its management token (round 385).

    Ownership-scoped exactly like the reader delete: an unknown token (or a
    token matching no comment) is a 404, so ids are not enumerable. Replies are
    reparented (comments_service.delete_guest_comment) so the thread stays coherent.
    """
    try:
        deleted = await comments_service.delete_guest_comment(db, token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found")
    return Response(status_code=204)


@router.post("/{comment_id}/flag")
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
async def flag_comment(
    request: Request,  # noqa: ARG001
    response: Response,
    comment_id: IdInt,
    body: CommentFlagBody | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Flag a comment for moderator review (DEC-108, TASK-166).

    Anonymous/reader, rate-limited, idempotent per (comment, source IP). A
    comment on a draft or otherwise non-public post responds 404 (same as an
    unknown id) so the endpoint never answers existence questions about drafts.
    Returns the distinct-flag count (not exposed on the public schema).
    """
    comment = await db.get(models.Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    post = await db.get(models.Post, comment.post_id)
    if not post or not comments_service.is_publicly_visible(post):
        raise HTTPException(status_code=404, detail="Comment not found")
    reason = (body.reason if body is not None else None) or None
    created, total = await comments_service.flag_comment(db, comment_id, client_rate_key(request), reason=reason)
    response.status_code = 201 if created else 200
    return {"comment_id": comment_id, "flags": total, "is_new": created}


@router.delete("/{comment_id}", status_code=204)
@limiter.limit(f"{RATE_LIMIT_COMMENT}/minute")
async def delete_comment(
    request: Request,  # noqa: ARG001
    comment_id: IdInt,
    _current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    try:
        success = await comments_service.delete_comment(db, comment_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found")
