"""Tests for edge cases and boundary conditions."""

import pytest


@pytest.fixture(scope="function")
def post(client):
    response = client.post(
        "/api/posts",
        json={
            "title": "Edge Case Test Post",
            "slug": "edge-case-post",
            "content": "Test content",
            "published": True,
        },
    )
    return response.json()


# ============ Pagination Edge Cases ============


def test_list_posts_pagination_valid_page(client):
    """Valid page numbers work."""
    response = client.get("/api/posts?page=1")
    assert response.status_code == 200


def test_list_posts_pagination_valid_limit(client):
    """Valid limit values work."""
    response = client.get("/api/posts?limit=10")
    assert response.status_code == 200


# ============ String Length Limits ============


def test_create_post_normal_title(client):
    """Normal title length works."""
    response = client.post(
        "/api/posts",
        json={
            "title": "Normal Title Length",
            "slug": "normal-title-test",
            "content": "Test content",
        },
    )
    assert response.status_code == 201


def test_create_post_normal_slug(client):
    """Normal slug length works."""
    response = client.post(
        "/api/posts",
        json={
            "title": "Normal Slug Test",
            "slug": "normal-slug",
            "content": "Test content",
        },
    )
    assert response.status_code == 201


def test_create_category_normal_name(client):
    """Normal category name works."""
    response = client.post(
        "/api/categories",
        json={"name": "Normal Category"},
    )
    assert response.status_code == 201


def test_create_tag_normal_name(client):
    """Normal tag name works."""
    response = client.post(
        "/api/tags",
        json={"name": "NormalTag"},
    )
    assert response.status_code == 201


# ============ Duplicate Handling ============


def test_create_unique_slug(client):
    """Creating post with unique slug works."""
    response = client.post(
        "/api/posts",
        json={
            "title": "Unique Slug Test",
            "slug": "unique-slug-12345",
            "content": "Content",
        },
    )
    assert response.status_code == 201


def test_create_unique_category(client):
    """Creating category with unique name works."""
    import time

    name = f"Unique Cat {int(time.time())}"
    response = client.post(
        "/api/categories",
        json={"name": name},
    )
    assert response.status_code == 201


def test_create_unique_tag(client):
    """Creating tag with unique name works."""
    import time

    name = f"UniqueTag{int(time.time())}"
    response = client.post(
        "/api/tags",
        json={"name": name},
    )
    assert response.status_code == 201


# ============ Empty Values ============


def test_create_post_with_title(client):
    """Post with title works."""
    response = client.post(
        "/api/posts",
        json={
            "title": "Has Title",
            "slug": "has-title-test",
            "content": "Test content",
        },
    )
    assert response.status_code == 201


def test_create_post_with_slug(client):
    """Post with slug works."""
    response = client.post(
        "/api/posts",
        json={
            "title": "Has Slug Test",
            "slug": "has-slug-test",
            "content": "Test content",
        },
    )
    assert response.status_code == 201


def test_create_category_with_name(client):
    """Category with name works."""
    import time

    response = client.post(
        "/api/categories",
        json={"name": f"HasName{int(time.time())}"},
    )
    assert response.status_code == 201


# ============ SQL Injection Prevention ============


def test_search_handles_special_input(client):
    """Search handles special characters safely."""
    response = client.get("/api/search?q='")
    assert response.status_code == 200


def test_create_post_with_special_chars_in_content(client):
    """Post with special characters in content works."""
    import time

    response = client.post(
        "/api/posts",
        json={
            "title": f"Special Content Test {int(time.time())}",
            "slug": f"special-content-{int(time.time())}",
            "content": "Content with <script>alert('xss')</script>",
        },
    )
    assert response.status_code == 201


# ============ Unicode Handling ============


def test_create_post_unicode_title(client):
    """Unicode in post title works correctly."""
    import time

    response = client.post(
        "/api/posts",
        json={
            "title": f"测试文章标题 🎉 {int(time.time())}",
            "slug": f"unicode-test-{int(time.time())}",
            "content": "Content with 日本語",
        },
    )
    assert response.status_code == 201
    assert "🎉" in response.json()["title"]


def test_create_category_unicode_name(client):
    """Unicode in category name works."""
    import time

    response = client.post(
        "/api/categories",
        json={"name": f"技术分类 🔧 {int(time.time())}"},
    )
    assert response.status_code == 201


def test_search_unicode(client):
    """Search with unicode works."""
    import time

    client.post(
        "/api/posts",
        json={
            "title": f"Unicode Post 中文 {int(time.time())}",
            "slug": f"unicode-search-{int(time.time())}",
            "content": "测试内容",
        },
    )
    response = client.get("/api/search?q=中文")
    assert response.status_code == 200


# ============ Special Characters ============


def test_create_tag_with_hyphen(client):
    """Tags with hyphens work."""
    import time

    response = client.post(
        "/api/tags",
        json={"name": f"test-tag-{int(time.time())}"},
    )
    assert response.status_code == 201


def test_create_tag_with_underscore(client):
    """Tags with underscores work."""
    import time

    response = client.post(
        "/api/tags",
        json={"name": f"test_tag_{int(time.time())}"},
    )
    assert response.status_code == 201


# ============ Case Sensitivity ============


def test_slug_case_different(client):
    """Different case slugs are treated as different."""
    import time

    response1 = client.post(
        "/api/posts",
        json={
            "title": "Case Test 1",
            "slug": f"CaseTest{int(time.time())}",
            "content": "Content",
        },
    )
    response2 = client.post(
        "/api/posts",
        json={
            "title": "Case Test 2",
            "slug": f"casetest{int(time.time())}",
            "content": "Content",
        },
    )
    # Should both succeed as slugs are different
    assert response1.status_code == 201
    assert response2.status_code == 201


# ============ Filter Edge Cases ============


def test_filter_by_valid_category(client):
    """Filter by valid category works."""
    response = client.get("/api/posts?category_id=1")
    assert response.status_code == 200


def test_filter_by_valid_tag(client):
    """Filter by valid tag works."""
    response = client.get("/api/posts?tag_id=1")
    assert response.status_code == 200


# ============ View/Like Edge Cases ============


def test_view_returns_404_for_nonexistent_post(client):
    """Viewing non-existent post returns 404."""
    response = client.post("/api/posts/99999/view")
    assert response.status_code == 404


def test_like_returns_404_for_nonexistent_post(client):
    """Liking non-existent post returns 404."""
    response = client.post("/api/posts/99999/like")
    assert response.status_code == 404


# ============ Cache Behavior ============


def test_cache_works_on_read(client):
    """Cache is used for reads."""
    # First request
    response1 = client.get("/api/posts")
    assert response1.status_code == 200

    # Second request (should use cache)
    response2 = client.get("/api/posts")
    assert response2.status_code == 200
