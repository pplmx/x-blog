"""Tests for cache module."""

from app.cache import (
    cache_clear,
    categories_cache,
    clear_categories_cache,
    clear_posts_cache,
    clear_stats_cache,
    clear_tags_cache,
    get_cache_info,
    posts_cache,
    stats_cache,
    tags_cache,
)


def test_cache_clear():
    """Test clearing all caches."""
    # Add something to cache first
    posts_cache["test"] = "value"
    categories_cache["test"] = "value"

    # Clear
    cache_clear()

    # Verify empty
    assert len(posts_cache) == 0
    assert len(categories_cache) == 0


def test_clear_posts_cache():
    """Test clearing posts cache specifically."""
    posts_cache["key1"] = "value1"
    posts_cache["key2"] = "value2"

    clear_posts_cache()

    assert len(posts_cache) == 0


def test_clear_categories_cache():
    """Test clearing categories cache specifically."""
    categories_cache["key"] = "value"

    clear_categories_cache()

    assert len(categories_cache) == 0


def test_clear_tags_cache():
    """Test clearing tags cache specifically."""
    tags_cache["key"] = "value"

    clear_tags_cache()

    assert len(tags_cache) == 0


def test_clear_stats_cache():
    """Test clearing stats cache specifically."""
    stats_cache["key"] = "value"

    clear_stats_cache()

    assert len(stats_cache) == 0


def test_get_cache_info():
    """Test getting cache information."""
    info = get_cache_info()

    # Check structure
    assert "posts" in info
    assert "categories" in info
    assert "tags" in info
    assert "stats" in info

    # Check each cache has required fields
    for _cache_name, cache_info in info.items():
        assert "size" in cache_info
        assert "maxsize" in cache_info
        assert "ttl" in cache_info
        assert isinstance(cache_info["size"], int)
        assert isinstance(cache_info["maxsize"], int)
        assert isinstance(cache_info["ttl"], int)
