"""In-memory cache implementation using cachetools."""

from collections.abc import Callable
from functools import wraps
from typing import Any, ParamSpec, TypeVar

from cachetools import TTLCache

from app.middleware.logging import get_logger

logger = get_logger(__name__)

# Cache instances
posts_cache = TTLCache(maxsize=100, ttl=300)  # 5 minutes for posts list
post_detail_cache = TTLCache(maxsize=50, ttl=300)  # 5 minutes for single post
categories_cache = TTLCache(maxsize=20, ttl=1800)  # 30 minutes for categories
tags_cache = TTLCache(maxsize=20, ttl=1800)  # 30 minutes for tags
stats_cache = TTLCache(maxsize=10, ttl=60)  # 1 minute for stats


def cache_clear():
    """Clear all caches."""
    posts_cache.clear()
    post_detail_cache.clear()
    categories_cache.clear()
    tags_cache.clear()
    stats_cache.clear()
    logger.info("cache_cleared")


def clear_posts_cache():
    """Clear posts-related caches."""
    posts_cache.clear()
    post_detail_cache.clear()
    logger.info("posts_cache_cleared")


def clear_categories_cache():
    """Clear categories cache."""
    categories_cache.clear()
    logger.info("categories_cache_cleared")


def clear_tags_cache():
    """Clear tags cache."""
    tags_cache.clear()
    logger.info("tags_cache_cleared")


def clear_stats_cache():
    """Clear stats cache."""
    stats_cache.clear()
    logger.info("stats_cache_cleared")


T = TypeVar("T")
P = ParamSpec("P")


def cached(cache: TTLCache, key_func: Callable[..., Any]):
    """Decorator to cache function results."""

    def decorator(func: Callable[P, T]) -> Callable[P, T]:
        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> T:
            # Generate cache key
            cache_key = key_func(*args, **kwargs)

            # Check cache
            if cache_key in cache:
                logger.debug("cache_hit", key=cache_key, cache=cache.__class__.__name__)
                return cache[cache_key]

            # Call function and cache result
            result = func(*args, **kwargs)
            cache[cache_key] = result
            logger.debug("cache_miss", key=cache_key, cache=cache.__class__.__name__)

            return result

        return wrapper

    return decorator


def get_cache_info() -> dict[str, dict[str, Any]]:
    """Get cache statistics."""
    return {
        "posts": {"size": len(posts_cache), "maxsize": posts_cache.maxsize, "ttl": posts_cache.ttl},
        "post_detail": {
            "size": len(post_detail_cache),
            "maxsize": post_detail_cache.maxsize,
            "ttl": post_detail_cache.ttl,
        },
        "categories": {"size": len(categories_cache), "maxsize": categories_cache.maxsize, "ttl": categories_cache.ttl},
        "tags": {"size": len(tags_cache), "maxsize": tags_cache.maxsize, "ttl": tags_cache.ttl},
        "stats": {"size": len(stats_cache), "maxsize": stats_cache.maxsize, "ttl": stats_cache.ttl},
    }
