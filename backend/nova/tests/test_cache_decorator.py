"""Tests for the cached decorator in cache module."""

from cachetools import TTLCache

from app.cache import cached


def test_cached_returns_cached_result_on_second_call():
    """The decorator should cache the result and return it on subsequent calls."""
    cache = TTLCache(maxsize=10, ttl=300)
    call_count = 0

    @cached(cache, key_func=lambda x: f"key:{x}")
    def expensive_function(x):
        nonlocal call_count
        call_count += 1
        return x * 2

    # First call — should execute the function
    result1 = expensive_function(5)
    assert result1 == 10
    assert call_count == 1

    # Second call with same key — should return cached result
    result2 = expensive_function(5)
    assert result2 == 10
    assert call_count == 1  # Function not called again


def test_cached_executes_function_on_cache_miss():
    """Different keys should result in separate function calls."""
    cache = TTLCache(maxsize=10, ttl=300)
    call_count = 0

    @cached(cache, key_func=lambda x: f"key:{x}")
    def compute(x):
        nonlocal call_count
        call_count += 1
        return x + 1

    assert compute(1) == 2
    assert compute(2) == 3
    assert compute(3) == 4
    assert call_count == 3


def test_cached_preserves_function_metadata():
    """The wrapped function should preserve the original function's name and docstring."""
    cache = TTLCache(maxsize=10, ttl=300)

    @cached(cache, key_func=lambda x: x)
    def my_function(x):
        """My function docstring."""
        return x

    assert my_function.__name__ == "my_function"
    assert my_function.__doc__ == "My function docstring."


def test_cached_works_with_kwargs():
    """The key_func should receive both args and kwargs."""
    cache = TTLCache(maxsize=10, ttl=300)
    call_count = 0

    @cached(cache, key_func=lambda x, y=None: f"key:{x}:{y}")
    def compute(x, y=None):
        nonlocal call_count
        call_count += 1
        return x + (y or 0)

    assert compute(1, y=2) == 3
    assert compute(1, y=2) == 3  # Cached
    assert call_count == 1

    assert compute(1, y=3) == 4  # Cache miss (different key)
    assert call_count == 2


def test_cached_stores_result_in_cache():
    """The cached result should be accessible via the cache directly."""
    cache = TTLCache(maxsize=10, ttl=300)

    @cached(cache, key_func=lambda x: f"key:{x}")
    def compute(x):
        return x * 10

    compute(5)
    assert cache["key:5"] == 50


def test_cached_with_different_caches():
    """Different cache instances should be independent."""
    cache_a = TTLCache(maxsize=10, ttl=300)
    cache_b = TTLCache(maxsize=10, ttl=300)
    call_count = 0

    @cached(cache_a, key_func=lambda x: x)
    def func_a(x):
        nonlocal call_count
        call_count += 1
        return x

    @cached(cache_b, key_func=lambda x: x)
    def func_b(x):
        nonlocal call_count
        call_count += 1
        return x

    assert func_a(1) == 1
    assert func_a(1) == 1  # Cached in cache_a
    assert call_count == 1

    assert func_b(1) == 1  # Different cache, so not cached
    assert call_count == 2
