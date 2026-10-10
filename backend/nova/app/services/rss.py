"""
RSS/sitemap service: aggregate feed rendering reads over posts, content and comments repositories.
"""

from app.repositories._base import (
    effective_publish_ts,
    utc_now_naive,
)
from app.repositories.categories import (
    get_categories,
    get_category,
    get_category_by_name,
)
from app.repositories.comments import (
    list_public_comment_feed,
)
from app.repositories.notifications import (
    maybe_notify_due_scheduled_posts,
)
from app.repositories.posts import (
    get_posts,
)
from app.repositories.series import (
    get_series_by_slug,
    get_series_visible_posts,
    list_series,
)
from app.repositories.tags import (
    get_tag,
    get_tags,
)

__all__ = [
    "effective_publish_ts",
    "get_categories",
    "get_category",
    "get_category_by_name",
    "get_posts",
    "get_series_by_slug",
    "get_series_visible_posts",
    "get_tag",
    "get_tags",
    "list_public_comment_feed",
    "list_series",
    "maybe_notify_due_scheduled_posts",
    "utc_now_naive",
]
