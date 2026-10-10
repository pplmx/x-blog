"""
Admin service: admin post lifecycle (create/clone/update/revisions) with the new-post notification + newsletter/push fan-out, and comment moderation orchestration.
"""

from __future__ import annotations

from app.emailer import (
    dispatch_newsletter_new_post,
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
    approve_comment,
    bulk_delete_comments,
    delete_comment_reparent,
    dismiss_comment_flags,
    flag_counts_for_comments,
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
    get_posts,
    record_slug_redirect,
    restore_post_revision,
    update_post,
)
from app.repositories.settings import (
    boolean_setting,
    upsert_site_setting,
)

__all__ = [
    "approve_comment",
    "boolean_setting",
    "bulk_delete_comments",
    "capture_post_revision",
    "clone_post",
    "create_post",
    "delete_comment_reparent",
    "delete_post",
    "dismiss_comment_flags",
    "dispatch_newsletter_new_post",
    "escape_like_pattern",
    "flag_counts_for_comments",
    "get_category",
    "get_post_revision",
    "get_post_revisions",
    "get_posts",
    "is_publicly_visible",
    "notify_post_published",
    "record_new_post_notifications",
    "record_slug_redirect",
    "restore_post_revision",
    "update_post",
    "upsert_site_setting",
    "utc_now_naive",
]
from app.webpush import dispatch_new_post


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
