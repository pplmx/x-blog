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


def test_stats_values_non_negative(client):
    """Test all stats values are non-negative."""
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    assert data["total_posts"] >= 0
    assert data["published_posts"] >= 0
    assert data["total_categories"] >= 0
    assert data["total_tags"] >= 0
    assert data["total_comments"] >= 0
    assert data["total_views"] >= 0


def test_stats_published_less_than_total(client):
    """Test published posts <= total posts."""
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    assert data["published_posts"] <= data["total_posts"]
