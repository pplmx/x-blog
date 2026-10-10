"""Tests for health check endpoints."""


async def test_health_check(client):
    """Test basic health check endpoint."""
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data


async def test_health_check_has_request_id(client):
    """Test health check returns request ID header."""
    response = await client.get("/health")
    assert response.status_code == 200
    assert "X-Request-ID" in response.headers


async def test_liveness_check(client):
    """Test liveness check endpoint."""
    response = await client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"


async def test_readiness_check(client):
    """Test readiness check endpoint."""
    response = await client.get("/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "checks" in data
    assert data["checks"]["database"] == "ok"


async def test_cache_stats(client):
    """Test cache statistics endpoint."""
    response = await client.get("/health/cache")
    assert response.status_code == 200
    data = response.json()
    assert set(data.keys()) == {"categories", "tags", "posts", "feeds"}
    assert "size" in data["categories"]
    assert "maxsize" in data["categories"]
    assert "ttl" in data["categories"]
    assert "size" in data["posts"]
    assert "maxsize" in data["posts"]
    assert "ttl" in data["posts"]
    assert "size" in data["feeds"]
    assert "maxsize" in data["feeds"]
    assert "ttl" in data["feeds"]


async def test_readiness_check_database_error(client):
    """Test readiness check returns not_ready when database is unavailable."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from app.routers import health

    mock_conn = AsyncMock()
    mock_conn.execute.side_effect = Exception("Database connection failed")
    # The readiness check now connects via `async with engine.connect()`.
    mock_engine = MagicMock()
    conn_cm = mock_engine.connect.return_value
    conn_cm.__aenter__ = AsyncMock(return_value=mock_conn)
    conn_cm.__aexit__ = AsyncMock(return_value=False)

    with patch.object(health, "engine", mock_engine):
        response = await client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "not_ready"
        assert "database" in data["checks"]
        assert "error" in data["checks"]["database"]


async def test_validation_error_format(client, auth_headers):
    """Test validation errors return standardized format."""
    response = await client.post("/api/posts", json={"invalid": "data"}, headers=auth_headers)
    assert response.status_code == 422
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "VALIDATION_ERROR"
    assert "message" in data["error"]
    assert "details" in data["error"]


async def test_not_found_error_format(client):
    """Test 404 errors return standardized format."""
    response = await client.get("/api/posts/99999")
    assert response.status_code == 404
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "NOT_FOUND"
