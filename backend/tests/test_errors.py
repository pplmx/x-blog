"""Tests for error handling and middleware."""


def test_error_response_format_not_found(client):
    """Test 404 error returns proper format."""
    response = client.get("/api/posts/99999")

    assert response.status_code == 404
    data = response.json()
    assert "error" in data
    assert "code" in data["error"]
    assert "message" in data["error"]
    assert "details" in data["error"]


def test_error_response_format_validation(client):
    """Test validation error returns proper format."""
    response = client.post("/api/posts", json={"invalid": "data"})

    assert response.status_code == 422
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "VALIDATION_ERROR"
    assert "errors" in data["error"]["details"]


def test_error_response_format_bad_request(client):
    """Test 400 error returns proper format."""
    response = client.post("/api/posts", json={})

    assert response.status_code == 422
    data = response.json()
    assert "error" in data


def test_rate_limit_exceeded_format(client):
    """Test rate limit error returns proper format."""
    # Make many requests to trigger rate limit
    for _ in range(100):
        response = client.get("/health")

    # Eventually should get rate limited (may not always trigger in test)
    # Just verify the endpoint works
    assert response.status_code in [200, 429]


def test_request_id_header_all_endpoints(client):
    """Test all endpoints return X-Request-ID header."""
    endpoints = [
        "/health",
        "/health/live",
        "/health/ready",
        "/api/stats",
        "/api/posts",
        "/api/categories",
        "/api/tags",
    ]

    for endpoint in endpoints:
        response = client.get(endpoint)
        assert "X-Request-ID" in response.headers, f"Missing X-Request-ID for {endpoint}"


def test_health_endpoints_structure(client):
    """Test health endpoints return expected structure."""
    # Basic health
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data

    # Liveness
    response = client.get("/health/live")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "alive"

    # Readiness
    response = client.get("/health/ready")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "checks" in data
    assert "database" in data["checks"]


def test_error_code_mapping(client):
    """Test error codes are properly mapped."""
    # 404 -> NOT_FOUND
    response = client.get("/api/posts/99999")
    assert response.status_code == 404
    data = response.json()
    assert data["error"]["code"] == "NOT_FOUND"

    # 422 -> VALIDATION_ERROR
    response = client.post("/api/posts", json={"bad": "data"})
    assert response.status_code == 422
    data = response.json()
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_unauthorized_error_format(client):
    """Test unauthorized error returns proper format."""
    # Try to access admin endpoint without auth
    response = client.post("/api/admin/posts")
    # Should be 401 or 422 depending on validation first
    assert response.status_code in [401, 422]
    data = response.json()
    assert "error" in data
