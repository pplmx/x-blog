"""Tags service: tag read/write for the tag router.

Thin orchestration seam aligned with the repositories.tags data layer,
preserving a per-domain service entry so routers never touch the data layer
directly. Splits the former ``services.content`` pseudo-domain.
"""

from __future__ import annotations

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
    "create_tag",
    "delete_tag",
    "get_tag",
    "get_tag_by_name",
    "get_tags",
    "tag_visible_post_count",
    "update_tag",
]
