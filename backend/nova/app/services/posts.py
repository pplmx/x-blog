"""
Posts service: post read/write/list/detail orchestration (archive, related, subscriptions, views, likes).
"""

from __future__ import annotations

from app.repositories._base import (
    is_publicly_visible,
)
from app.repositories.notifications import (
    maybe_notify_due_scheduled_posts,
)
from app.repositories.posts import (
    create_post,
    delete_post,
    get_adjacent_posts,
    get_archive,
    get_popular_posts,
    get_post,
    get_post_by_slug,
    get_posts,
    get_related_posts,
    get_trending_posts,
    increment_likes,
    increment_views,
    resolve_slug_redirect,
    update_post,
)
from app.repositories.subscriptions import (
    add_comment_subscription,
    add_guest_comment_subscription,
    confirm_guest_comment_subscription,
    get_comment_subscription,
    get_guest_comment_subscription_by_token,
    remove_comment_subscription,
    set_guest_thread_digest,
    unsubscribe_guest_comment_subscription,
)

__all__ = [
    "add_comment_subscription",
    "add_guest_comment_subscription",
    "confirm_guest_comment_subscription",
    "create_post",
    "delete_post",
    "get_adjacent_posts",
    "get_archive",
    "get_comment_subscription",
    "get_guest_comment_subscription_by_token",
    "get_popular_posts",
    "get_post",
    "get_post_by_slug",
    "get_posts",
    "get_related_posts",
    "get_trending_posts",
    "increment_likes",
    "increment_views",
    "is_publicly_visible",
    "maybe_notify_due_scheduled_posts",
    "remove_comment_subscription",
    "resolve_slug_redirect",
    "set_guest_thread_digest",
    "unsubscribe_guest_comment_subscription",
    "update_post",
]
