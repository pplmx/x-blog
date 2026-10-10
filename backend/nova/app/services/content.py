"""
Content service: categories, tags, series and slug-redirect orchestration.
"""

from __future__ import annotations

from app.repositories.categories import (
    category_visible_post_count,
    create_category,
    delete_category,
    get_categories,
    get_category,
    get_category_by_name,
    update_category,
)
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
from app.repositories.tags import (
    create_tag,
    delete_tag,
    get_tag,
    get_tag_by_name,
    get_tags,
    tag_visible_post_count,
    update_tag,
)

__all__ = [
    "category_visible_post_count",
    "create_category",
    "create_series",
    "create_tag",
    "delete_category",
    "delete_series",
    "delete_tag",
    "get_categories",
    "get_category",
    "get_category_by_name",
    "get_series_by_slug",
    "get_series_visible_posts",
    "get_tag",
    "get_tag_by_name",
    "get_tags",
    "list_series",
    "list_series_episodes",
    "record_slug_redirect",
    "reorder_series_episodes",
    "resolve_slug_redirect",
    "tag_visible_post_count",
    "update_category",
    "update_series",
    "update_tag",
    "visible_series_post_counts",
]
