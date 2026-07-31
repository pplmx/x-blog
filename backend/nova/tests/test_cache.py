"""Tests for cache module.

The posts/detail/stats caches and the cached() decorator were removed in the
dead-code cleanup: they were never read by the application, so the earlier
clear_posts_cache()/clear_stats_cache() calls were no-ops. Only the caches the
app actually uses (categories, tags) are covered here.
"""

import pytest

from app.cache import (
    cache_clear,
    categories_cache,
    clear_categories_cache,
    clear_tags_cache,
    get_cache_info,
    tags_cache,
)
from app.database import get_db


def test_cache_clear():
    """Test clearing all caches."""
    # Add something to cache first
    categories_cache["test"] = "value"
    tags_cache["test"] = "value"

    # Clear
    cache_clear()

    # Verify empty
    assert len(categories_cache) == 0
    assert len(tags_cache) == 0


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


def test_get_cache_info():
    """Test getting cache information."""
    info = get_cache_info()

    # Check structure — only caches the app actually reads are reported
    assert set(info.keys()) == {"categories", "tags"}

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
