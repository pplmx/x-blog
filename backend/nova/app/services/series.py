"""Series service: series + slug-redirect read/write for the series/pages routers.

Thin orchestration seam aligned with the repositories.series data layer.
``record/resolve_slug_redirect`` ride along here (their repo home is
``repositories.posts``); they are shared by the series and pages routers,
which both depend on this service.
"""

from __future__ import annotations

from app.repositories.posts import (
    record_slug_redirect,
    resolve_slug_redirect,
)
from app.repositories.series import (
    create_series,
    delete_series,
    get_series_by_slug,
    get_series_visible_posts,
    list_series,
    list_series_episodes,
    reorder_series_episodes,
    update_series,
    visible_series_post_counts,
)

__all__ = [
    "create_series",
    "delete_series",
    "get_series_by_slug",
    "get_series_visible_posts",
    "list_series",
    "list_series_episodes",
    "record_slug_redirect",
    "reorder_series_episodes",
    "resolve_slug_redirect",
    "update_series",
    "visible_series_post_counts",
]
