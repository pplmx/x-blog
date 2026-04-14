"""Tests for stats endpoint."""


def test_get_stats(client):
    """Test get blog stats endpoint."""
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    # Check all expected fields exist
    assert "total_posts" in data
    assert "published_posts" in data
    assert "total_categories" in data
    assert "total_tags" in data
    assert "total_comments" in data
    assert "total_views" in data

    # Check types
    assert isinstance(data["total_posts"], int)
    assert isinstance(data["published_posts"], int)
    assert isinstance(data["total_categories"], int)
    assert isinstance(data["total_tags"], int)
    assert isinstance(data["total_comments"], int)
    assert isinstance(data["total_views"], int)


def test_stats_has_request_id(client):
    """Test stats endpoint returns request ID header."""
    response = client.get("/api/stats")
    assert response.status_code == 200
    assert "X-Request-ID" in response.headers
