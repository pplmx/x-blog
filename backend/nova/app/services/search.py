"""
Search service: full-text post/series/page/author/comment search and search-query logging.
"""

from __future__ import annotations

from app.repositories.comments import (
    search_comments,
)
from app.repositories.notifications import (
    maybe_notify_due_scheduled_posts,
)
from app.repositories.search import (
    _has_cjk,
    _has_searchable_token,
    log_search_query,
    search_authors,
    search_pages,
    search_posts,
    search_series,
)

__all__ = [
    "_has_cjk",
    "_has_searchable_token",
    "log_search_query",
    "maybe_notify_due_scheduled_posts",
    "search_authors",
    "search_comments",
    "search_pages",
    "search_posts",
    "search_series",
]
