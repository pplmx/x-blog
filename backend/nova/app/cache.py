"""In-memory cache implementation using cachetools.

Caches that are actually read by the application live here:
- categories_cache / tags_cache: long-lived (30 min) for enum-like data.
- posts_list_cache: short-lived (5 min TTL) serialized PostListResponse
  payloads keyed by (page, limit, category_id, tag_id). Values are plain dicts
  (never live ORM objects) so they survive across per-request Sessions.
  Invalidated on post create/update/delete (admin writes); views/likes do NOT
  invalidate it because they don't change the list ordering or content.
"""

from cachetools import TTLCache

from app import models
from app.middleware.logging import get_logger

logger = get_logger(__name__)

# Cache instances. Key/value types are explicit (3-arg cachetools generic:
# key, value, size type) so pyright can type the subscript reads in
# crud.get_categories/get_tags. The constructor cannot bind KT/VT from its
# args, so assignments are typed-declared with an ignore; readers see the
# declared type.
categories_cache: TTLCache[str, list[models.Category], float] = TTLCache(  # type: ignore[reportAssignmentType]
    maxsize=20,
    ttl=1800,  # 30 minutes for categories
)
tags_cache: TTLCache[str, list[models.Tag], float] = TTLCache(  # type: ignore[reportAssignmentType]
    maxsize=20,
    ttl=1800,  # 30 minutes for tags
)
# Serialized PostListResponse payloads keyed by (page, limit, category_id, tag_id).
# Stores dicts, not ORM objects, so values survive across request Sessions.
# A 5-minute TTL is a safety net: writes invalidate explicitly, but a scheduled
# post crossing its publish_at without a write still refreshes within the TTL.
posts_list_cache: TTLCache[tuple, dict, float] = TTLCache(  # type: ignore[reportAssignmentType]
    maxsize=256, ttl=300
)
# Rendered RSS/Atom/sitemap bodies keyed by feed name ("feed", "atom", "sitemap").
# Rendering markdown per request is expensive (full DB query + sanitizer), so
# cache the serialized XML and invalidate on any post write. A 5-minute TTL is
# a safety net (same refresh window as the posts list). Sitemap also depends on
# categories/tags, which changes on those writes via their own clears, but a
# stale sitemap for up to 5 min is acceptable.
feed_cache: TTLCache[str, str, float] = TTLCache(  # type: ignore[reportAssignmentType]
    maxsize=8, ttl=300
)


def cache_clear():
    """Clear all caches."""
    categories_cache.clear()
    tags_cache.clear()
    posts_list_cache.clear()
    feed_cache.clear()
    logger.info("cache_cleared")


def clear_categories_cache():
    """Clear categories cache."""
    categories_cache.clear()
    logger.info("categories_cache_cleared")


def clear_tags_cache():
    """Clear tags cache."""
    tags_cache.clear()
    logger.info("tags_cache_cleared")


def clear_posts_list_cache():
    """Clear the posts list cache (invalidated on any post write).

    Also clears the rendered RSS/Atom/sitemap feeds — they derive from the same
    published post set (and content), so a write must invalidate them too.
    """
    posts_list_cache.clear()
    feed_cache.clear()
    logger.info("posts_list_cache_cleared")


def get_cache_info() -> dict[str, dict[str, int | float]]:
    """Get cache statistics."""
    return {
        "categories": {"size": len(categories_cache), "maxsize": categories_cache.maxsize, "ttl": categories_cache.ttl},
        "tags": {"size": len(tags_cache), "maxsize": tags_cache.maxsize, "ttl": tags_cache.ttl},
        "posts": {"size": len(posts_list_cache), "maxsize": posts_list_cache.maxsize, "ttl": posts_list_cache.ttl},
        "feeds": {"size": len(feed_cache), "maxsize": feed_cache.maxsize, "ttl": feed_cache.ttl},
    }
