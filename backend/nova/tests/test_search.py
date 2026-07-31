"""Tests for search functionality."""

import pytest


@pytest.fixture(scope="module")
def search_post(client, auth_headers):
    """Create a post for search tests."""
    client.post(
        "/api/posts",
        json={
            "title": "Python Tutorial",
            "slug": "python-tutorial",
            "content": "Learn Python programming",
            "published": True,
        },
        headers=auth_headers,
    )


def test_search_posts(client, auth_headers):
    client.post(
        "/api/posts",
        json={
            "title": "Python Tutorial",
            "slug": "python-tutorial-search",
            "content": "Learn Python programming",
            "published": True,
        },
        headers=auth_headers,
    )
    client.post(
        "/api/posts",
        json={
            "title": "JavaScript Guide",
            "slug": "javascript-guide-search",
            "content": "Learn JavaScript",
            "published": True,
        },
        headers=auth_headers,
    )

    response = client.get("/api/search", params={"q": "Python"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["title"] == "Python Tutorial"


def test_search_pagination(client, auth_headers):
    client.post(
        "/api/posts",
        json={
            "title": "Python Tutorial",
            "slug": "python-tutorial-pg",
            "content": "Learn Python programming",
            "published": True,
        },
        headers=auth_headers,
    )
    client.post(
        "/api/posts",
        json={
            "title": "JavaScript Guide",
            "slug": "javascript-guide-pg",
            "content": "Learn JavaScript",
            "published": True,
        },
        headers=auth_headers,
    )

    response = client.get("/api/search", params={"q": "Learn", "limit": 1, "page": 1})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["pagination"]["total"] == 2
    assert data["pagination"]["page"] == 1
    assert data["pagination"]["limit"] == 1


def test_search_no_results(client, auth_headers):
    client.post(
        "/api/posts",
        json={
            "title": "Python Tutorial",
            "slug": "python-tutorial-noresult",
            "content": "Learn Python programming",
            "published": True,
        },
        headers=auth_headers,
    )

    response = client.get("/api/search", params={"q": "Nonexistent"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 0
    assert data["pagination"]["total"] == 0


def test_search_empty_query(client, auth_headers):
    client.post(
        "/api/posts",
        json={
            "title": "Test",
            "slug": "test-empty-query",
            "content": "Content",
            "published": True,
        },
        headers=auth_headers,
    )

    response = client.get("/api/search?q=%20")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data


def test_search_special_characters(client, db_session):
    from app import models

    post = models.Post(
        title="Test Special",
        slug="test-special-chars",
        content="Content with special chars: @#$%^&*()",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/search?q=@#$%")
    assert response.status_code == 200


def test_search_case_insensitive(client, db_session):
    from app import models

    post = models.Post(
        title="Hello World",
        slug="hello-world-case",
        content="Hello content",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/search?q=hello")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1

    response_upper = client.get("/api/search?q=HELLO")
    data_upper = response_upper.json()
    assert len(data_upper["items"]) == 1


def test_highlight_sqlite_empty_query():
    """Test _highlight_sqlite returns truncated content for empty query."""
    from app.routers.search import _highlight_sqlite

    result = _highlight_sqlite("Some content here", "")
    assert result == "Some content here"


def test_highlight_sqlite_highlights_matches():
    """Test _highlight_sqlite wraps matching words in <mark> tags."""
    from app.routers.search import _highlight_sqlite

    result = _highlight_sqlite("The quick brown fox", "quick")
    assert "<mark>quick</mark>" in result
    assert "The " in result


def test_build_snippet_empty_query_returns_none():
    """Test _build_snippet returns None for empty/whitespace query."""
    from unittest.mock import MagicMock

    from app.routers.search import _build_snippet

    mock_post = MagicMock()
    mock_db = MagicMock()
    result = _build_snippet(mock_post, "   ", False, mock_db)
    assert result is None


def test_build_snippet_sqlite_highlight():
    """Test _build_snippet returns highlighted text for SQLite with non-empty query."""
    from unittest.mock import MagicMock

    from app.routers.search import _build_snippet

    mock_post = MagicMock()
    mock_post.excerpt = "Hello world content"
    mock_post.content = "Hello world content"
    mock_db = MagicMock()
    result = _build_snippet(mock_post, "hello", False, mock_db)
    assert result is not None
    assert "<mark>hello</mark>" in result.lower() or "<mark>Hello</mark>" in result


def test_search_excludes_scheduled_posts(client, auth_headers):
    """Future-dated posts must not appear in search results before publish_at."""
    client.post(
        "/api/posts",
        json={
            "title": "Future Scheduled Secret",
            "slug": "future-scheduled-secret",
            "content": "This should not be searchable yet",
            "published": True,
            "publish_at": "2099-01-01T00:00:00",
        },
        headers=auth_headers,
    )
    client.post(
        "/api/posts",
        json={
            "title": "Regular Searchable Post",
            "slug": "regular-searchable-post",
            "content": "This is searchable",
            "published": True,
        },
        headers=auth_headers,
    )

    response = client.get("/api/search", params={"q": "searchable"})
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert "Regular Searchable Post" in titles
    assert "Future Scheduled Secret" not in titles

    # Search for the scheduled post's unique content directly
    response = client.get("/api/search", params={"q": "Future Scheduled Secret"})
    assert response.status_code == 200
    assert len(response.json()["items"]) == 0


def test_popular_posts_excludes_scheduled(client, auth_headers):
    """Future-dated posts must not appear in the popular posts list."""
    client.post(
        "/api/posts",
        json={
            "title": "Future Popular",
            "slug": "future-popular",
            "content": "Should not appear",
            "published": True,
            "publish_at": "2099-01-01T00:00:00",
        },
        headers=auth_headers,
    )
    client.post(
        "/api/posts",
        json={
            "title": "Past Popular",
            "slug": "past-popular",
            "content": "Should appear",
            "published": True,
        },
        headers=auth_headers,
    )
    # Boost the past post's views so it ranks
    past_id = client.get("/api/search", params={"q": "Past"}).json()["items"][0]["id"]
    client.post(f"/api/posts/{past_id}/view")

    response = client.get("/api/posts/popular/list")
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()]
    assert "Past Popular" in titles
    assert "Future Popular" not in titles
