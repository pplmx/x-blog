"""Tests for health check endpoints."""


def test_health_check(client):
    """Test basic health check endpoint."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data


def test_health_check_has_request_id(client):
    """Test health check returns request ID header."""
    response = client.get("/health")
    assert response.status_code == 200
    assert "X-Request-ID" in response.headers


def test_liveness_check(client):
    """Test liveness check endpoint."""
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"


def test_readiness_check(client):
    """Test readiness check endpoint."""
    response = client.get("/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "checks" in data
    assert data["checks"]["database"] == "ok"


def test_cache_stats(client):
    """Test cache statistics endpoint."""
    response = client.get("/health/cache")
    assert response.status_code == 200
    data = response.json()
    assert "posts" in data
    assert "post_detail" in data
    assert "categories" in data
    assert "tags" in data
    assert "stats" in data
    assert "size" in data["posts"]
    assert "maxsize" in data["posts"]
    assert "ttl" in data["posts"]


def test_readiness_check_database_error(client):
    """Test readiness check returns not_ready when database is unavailable."""
    from app.routers import health
    from unittest.mock import patch, MagicMock

    mock_conn = MagicMock()
    mock_conn.execute.side_effect = Exception("Database connection failed")
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)

    with patch.object(health.engine, "connect", return_value=mock_conn):
        response = client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "not_ready"
        assert "database" in data["checks"]
        assert "error" in data["checks"]["database"]


def test_validation_error_format(client):
    """Test validation errors return standardized format."""
    response = client.post("/api/posts", json={"invalid": "data"})
    assert response.status_code == 422
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "VALIDATION_ERROR"
    assert "message" in data["error"]
    assert "details" in data["error"]


def test_not_found_error_format(client):
    """Test 404 errors return standardized format."""
    response = client.get("/api/posts/99999")
    assert response.status_code == 404
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "NOT_FOUND"
