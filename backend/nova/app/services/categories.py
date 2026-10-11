"""Categories service: category read/write for the category router.

Thin orchestration seam aligned with the repositories.categories data layer,
preserving a per-domain service entry so routers never touch the data layer
directly. Splits the former ``services.content`` pseudo-domain (which fused
categories, tags and series regardless of their separate repos/routers).
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

__all__ = [
    "category_visible_post_count",
    "create_category",
    "delete_category",
    "get_categories",
    "get_category",
    "get_category_by_name",
    "update_category",
]
