"""In-memory cache implementation using cachetools.

Only caches that are actually read by the application live here. The posts
list/detail paths are deliberately NOT cached (ORM objects would go stale or
detach across request sessions); the clear_posts_cache() calls that used to
exist were no-ops and have been removed.
"""

from cachetools import TTLCache

from app.middleware.logging import get_logger

logger = get_logger(__name__)

# Cache instances
categories_cache = TTLCache(maxsize=20, ttl=1800)  # 30 minutes for categories
tags_cache = TTLCache(maxsize=20, ttl=1800)  # 30 minutes for tags


def cache_clear():
    """Clear all caches."""
    categories_cache.clear()
    tags_cache.clear()
    logger.info("cache_cleared")


def clear_categories_cache():
    """Clear categories cache."""
    categories_cache.clear()
    logger.info("categories_cache_cleared")


def clear_tags_cache():
    """Clear tags cache."""
    tags_cache.clear()
    logger.info("tags_cache_cleared")


def get_cache_info() -> dict[str, dict[str, int | float]]:
    """Get cache statistics."""
    return {
        "categories": {"size": len(categories_cache), "maxsize": categories_cache.maxsize, "ttl": categories_cache.ttl},
        "tags": {"size": len(tags_cache), "maxsize": tags_cache.maxsize, "ttl": tags_cache.ttl},
    }
