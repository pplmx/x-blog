"""Tests for stats endpoint."""


def test_get_stats(client):
    """Test get blog stats endpoint."""
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()

    # Check all expected fields exist
    assert "total_posts" in data
    assert "published_posts" in data
    assert "scheduled_posts" in data
    assert "total_categories" in data
    assert "total_tags" in data
    assert "total_comments" in data
    assert "total_views" in data
    assert "total_likes" in data

    # Check types
    assert isinstance(data["total_posts"], int)
    assert isinstance(data["published_posts"], int)
    assert isinstance(data["scheduled_posts"], int)
    assert isinstance(data["total_categories"], int)
    assert isinstance(data["total_tags"], int)
    assert isinstance(data["total_comments"], int)
    assert isinstance(data["total_views"], int)
    assert isinstance(data["total_likes"], int)


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


def test_stats_scheduled_post_not_counted_as_published(client, auth_headers):
    """A future-dated post must not inflate the published_posts count."""
    client.post(
        "/api/posts",
        json={
            "title": "Scheduled Stats Post",
            "slug": "scheduled-stats-post",
            "content": "Not published yet",
            "published": True,
            "publish_at": "2099-01-01T00:00:00",
        },
        headers=auth_headers,
    )
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()
    assert data["published_posts"] == 0
    assert data["scheduled_posts"] == 1
    assert data["total_posts"] == 1


def test_stats_scheduled_post_is_not_a_draft(client, auth_headers):
    """A future-dated post counts as scheduled, so drafts = total - published - scheduled.

    Regression for RIL TASK-036: the dashboard derives draftCount =
    total_posts - published_posts, which would otherwise fold scheduled posts
    into the draft bucket (the admin list treats them as a distinct status).
    """
    # published draft
    client.post(
        "/api/posts",
        json={
            "title": "Real Draft",
            "slug": "real-draft",
            "content": "working draft",
            "published": False,
        },
        headers=auth_headers,
    )
    # scheduled (published=True but future publish_at)
    client.post(
        "/api/posts",
        json={
            "title": "Scheduled Post",
            "slug": "scheduled-post",
            "content": "not yet",
            "published": True,
            "publish_at": "2099-01-01T00:00:00",
        },
        headers=auth_headers,
    )
    response = client.get("/api/stats")
    assert response.status_code == 200
    data = response.json()
    # 2 posts: 1 draft + 1 scheduled, nothing published yet
    assert data["total_posts"] == 2
    assert data["published_posts"] == 0
    assert data["scheduled_posts"] == 1
    # The dashboard's draft derivation must leave exactly 1 draft.
    assert data["total_posts"] - data["published_posts"] - data["scheduled_posts"] == 1
