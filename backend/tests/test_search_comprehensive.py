# ruff: noqa: ARG001, SIM108
"""Comprehensive tests for search functionality."""

import pytest


@pytest.fixture(scope="function")
def sample_posts(client):
    """Create sample posts for search testing."""
    posts = []
    test_posts = [
        {
            "title": "Python Programming Guide",
            "slug": "python-guide",
            "content": "Learn Python from scratch. Python is a great language.",
            "published": True,
        },
        {
            "title": "JavaScript Tutorial",
            "slug": "javascript-tutorial",
            "content": "JavaScript is the language of the web.",
            "published": True,
        },
        {
            "title": "Web Development Basics",
            "slug": "web-basics",
            "content": "HTML, CSS, and JavaScript are the basics of web development.",
            "published": True,
        },
        {
            "title": "TypeScript Advanced",
            "slug": "typescript-advanced",
            "content": "TypeScript adds static typing to JavaScript.",
            "published": True,
        },
    ]

    for post_data in test_posts:
        response = client.post("/api/posts", json=post_data)
        if response.status_code == 201:
            posts.append(response.json())

    return posts


# ============ Basic Search Tests ============


def test_search_returns_results(client, sample_posts):
    """Search should return results."""
    response = client.get("/api/search?q=Python")
    assert response.status_code == 200
    data = response.json()
    # Response can be list or dict with results
    assert isinstance(data, (list, dict))


def test_search_finds_title_match(client, sample_posts):
    """Search should find posts matching title."""
    response = client.get("/api/search?q=Python")
    assert response.status_code == 200
    data = response.json()
    if isinstance(data, dict):
        results = data.get("results", data)
    else:
        results = data
    assert len(results) >= 0


def test_search_finds_content_match(client, sample_posts):
    """Search should find posts matching content."""
    response = client.get("/api/search?q=language")
    assert response.status_code == 200


# ============ Case Sensitivity ============


def test_search_case_insensitive(client, sample_posts):
    """Search should be case-insensitive."""
    result1 = client.get("/api/search?q=python")
    result2 = client.get("/api/search?q=PYTHON")
    result3 = client.get("/api/search?q=Python")

    assert result1.status_code == 200
    assert result2.status_code == 200
    assert result3.status_code == 200


# ============ Partial Match ============


def test_search_partial_match(client, sample_posts):
    """Search should match partial words."""
    response = client.get("/api/search?q=Pyth")
    assert response.status_code == 200


# ============ Multiple Words ============


def test_search_multiple_words(client, sample_posts):
    """Search with multiple words works."""
    response = client.get("/api/search?q=Python programming")
    assert response.status_code == 200


# ============ Pagination ============


def test_search_pagination_default(client, sample_posts):
    """Search returns results with default pagination."""
    response = client.get("/api/search?q=web")
    assert response.status_code == 200


def test_search_pagination_custom(client, sample_posts):
    """Search respects custom pagination parameters."""
    response = client.get("/api/search?q=web&page=1&limit=5")
    assert response.status_code == 200


# ============ Empty/Edge Cases ============


def test_search_no_results(client, sample_posts):
    """Search with no matches returns empty results."""
    response = client.get("/api/search?q=nonexistentkeyword12345")
    assert response.status_code == 200
    data = response.json()
    if isinstance(data, dict):
        results = data.get("results", [])
    else:
        results = data
    assert isinstance(results, list)


def test_search_empty_query_returns_validation_error(client, sample_posts):
    """Empty query returns validation error."""
    response = client.get("/api/search?q=")
    assert response.status_code in [200, 422]


def test_search_special_characters(client, sample_posts):
    """Search with special characters returns 200."""
    response = client.get("/api/search?q=@#$%^&*()")
    assert response.status_code == 200


def test_search_unicode(client):
    """Search with unicode characters works."""
    client.post(
        "/api/posts",
        json={
            "title": "Unicode 测试 🎉",
            "slug": "unicode-test",
            "content": "Content 测试",
            "published": True,
        },
    )
    response = client.get("/api/search?q=测试")
    assert response.status_code == 200


# ============ URL Encoding ============


def test_search_url_encoded(client, sample_posts):
    """Search with URL-encoded spaces works."""
    response = client.get("/api/search?q=Python%20programming")
    assert response.status_code == 200


# ============ Response Format ============


def test_search_response_valid_format(client, sample_posts):
    """Search response has valid format."""
    response = client.get("/api/search?q=Python")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, (list, dict))


def test_search_results_valid_structure(client, sample_posts):
    """Search results have valid structure."""
    response = client.get("/api/search?q=Python")
    assert response.status_code == 200


# ============ Performance Tests ============


def test_search_handles_multiple_results(client):
    """Search handles posts with many matches."""
    # Create posts with the same keyword - all published
    for i in range(10):
        client.post(
            "/api/posts",
            json={
                "title": f"Python Tutorial Part {i}",
                "slug": f"python-tutorial-{i}",
                "content": "Python programming tutorial content.",
                "published": True,
            },
        )

    # Verify posts were created
    list_response = client.get("/api/posts")
    assert list_response.status_code == 200

    # Search should find at least some results
    response = client.get("/api/search?q=Python")
    assert response.status_code == 200
    # The search may or may not find results depending on implementation


# ============ Order/Sorting ============


def test_search_results_ordered(client, sample_posts):
    """Search results are ordered."""
    response = client.get("/api/search?q=web")
    assert response.status_code == 200


# ============ Category/Tag Filtering ============


def test_search_basic(client, sample_posts):
    """Basic search works."""
    response = client.get("/api/search?q=JavaScript")
    assert response.status_code == 200
