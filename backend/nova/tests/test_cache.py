"""Tests for cache module.

Covers the in-app caches: categories_cache, tags_cache (30-min TTL), and
posts_list_cache (5-min TTL, serialized-dict payloads, write-invalidated).
The posts/detail/stats caches and the cached() decorator were removed in a
prior dead-code cleanup; only the caches the app actually reads are covered.
"""

import pytest

from app.cache import (
    cache_clear,
    categories_cache,
    clear_categories_cache,
    clear_posts_list_cache,
    clear_tags_cache,
    get_cache_info,
    posts_list_cache,
    tags_cache,
)
from app.database import get_db


def test_cache_clear():
    """Test clearing all caches."""
    # Add something to cache first
    categories_cache["test"] = "value"
    tags_cache["test"] = "value"
    posts_list_cache["test"] = "value"

    # Clear
    cache_clear()

    # Verify empty
    assert len(categories_cache) == 0
    assert len(tags_cache) == 0
    assert len(posts_list_cache) == 0


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


def test_clear_posts_list_cache():
    """Test clearing the posts list cache specifically."""
    posts_list_cache[(1, 10, None, None)] = [{"id": 1}]

    clear_posts_list_cache()

    assert len(posts_list_cache) == 0


def test_posts_list_cache_set_get():
    """Test set/get lifecycle of the posts list cache."""
    assert posts_list_cache.get((2, 10, None, None)) is None
    payload = {"items": [{"id": 2}], "pagination": {"page": 2}}
    posts_list_cache[(2, 10, None, None)] = payload
    assert posts_list_cache.get((2, 10, None, None)) == payload


def test_get_cache_info():
    """Test getting cache information."""
    info = get_cache_info()

    # Check structure — only caches the app actually reads are reported
    assert set(info.keys()) == {"categories", "tags", "posts"}

    # Check each cache has required fields
    for _cache_name, cache_info in info.items():
        assert "size" in cache_info
        assert "maxsize" in cache_info
        assert "ttl" in cache_info
        assert isinstance(cache_info["size"], int)
        assert isinstance(cache_info["maxsize"], int)
        assert isinstance(cache_info["ttl"], int)


def test_get_db_yields_session_and_closes():
    """get_db() should yield a Session instance and close it after use."""
    db_generator = get_db()
    db = next(db_generator)
    assert db is not None
    assert hasattr(db, "close")
    assert hasattr(db, "query")

    # The generator should raise StopIteration when exhausted, indicating
    # the finally block (db.close()) has executed.
    with pytest.raises(StopIteration):
        next(db_generator)
