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
