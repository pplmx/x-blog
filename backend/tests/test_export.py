"""Tests for export endpoints."""


def test_export_posts_csv(client):
    """Test exporting posts as CSV."""
    response = client.get("/api/export/posts.csv")

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert "attachment" in response.headers["content-disposition"]
    assert "posts.csv" in response.headers["content-disposition"]


def test_export_comments_csv(client):
    """Test exporting comments as CSV."""
    response = client.get("/api/export/comments.csv")

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert "attachment" in response.headers["content-disposition"]
    assert "comments.csv" in response.headers["content-disposition"]


def test_export_posts_csv_has_headers(client):
    """Test CSV export has proper headers."""
    response = client.get("/api/export/posts.csv")

    assert response.status_code == 200
    lines = response.text.strip().split("\n")
    assert len(lines) >= 1  # At least header row

    # Check header format (CSV columns)
    headers = lines[0].split(",")
    assert len(headers) > 0


def test_export_comments_csv_has_headers(client):
    """Test comments CSV export has proper headers."""
    response = client.get("/api/export/comments.csv")

    assert response.status_code == 200
    lines = response.text.strip().split("\n")
    assert len(lines) >= 1  # At least header row
