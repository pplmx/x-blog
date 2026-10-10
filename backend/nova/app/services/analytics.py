"""
Analytics/stats service: daily views, trends, following/search/comment stats, and blog + reader export timing helpers.
"""

from __future__ import annotations

from app.repositories._base import (
    utc_now_naive,
)
from app.repositories.analytics import (
    get_comment_activity_stats,
    get_daily_views_stats,
    get_post_views_trend,
)
from app.repositories.follows import (
    get_follow_stats,
)
from app.repositories.search import (
    get_top_searches,
)

__all__ = [
    "get_comment_activity_stats",
    "get_daily_views_stats",
    "get_follow_stats",
    "get_post_views_trend",
    "get_top_searches",
    "utc_now_naive",
]
