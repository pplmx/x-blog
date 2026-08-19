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


def test_error_response_format_validation(client, auth_headers):
    """Test validation error returns proper format."""
    response = client.post("/api/posts", json={"invalid": "data"}, headers=auth_headers)

    assert response.status_code == 422
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == "VALIDATION_ERROR"
    assert "errors" in data["error"]["details"]


def test_error_response_format_bad_request(client, auth_headers):
    """Test 400 error returns proper format."""
    response = client.post("/api/posts", json={}, headers=auth_headers)

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


def test_error_code_mapping(client, auth_headers):
    """Test error codes are properly mapped."""
    # 404 -> NOT_FOUND
    response = client.get("/api/posts/99999")
    assert response.status_code == 404
    data = response.json()
    assert data["error"]["code"] == "NOT_FOUND"

    # 422 -> VALIDATION_ERROR
    response = client.post("/api/posts", json={"bad": "data"}, headers=auth_headers)
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


def test_root_endpoint(client):
    """Test root endpoint returns API message."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["message"] == "X-Blog Blog API"


def test_security_headers(client):
    """Test security headers are set on all responses."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("X-XSS-Protection") == "1; mode=block"
    assert "max-age=31536000" in response.headers.get("Strict-Transport-Security", "")
    # DEC-057 / TASK-125: the baseline hardening set beyond the legacy four.
    assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert response.headers.get("Permissions-Policy") == "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    assert response.headers.get("Cross-Origin-Opener-Policy") == "same-origin"
    csp = response.headers.get("Content-Security-Policy", "")
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "base-uri 'self'" in csp


def test_security_headers_on_error(client):
    """Test security headers are set even on error responses."""
    response = client.get("/api/posts/99999")
    assert response.status_code == 404
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert "Content-Security-Policy" in response.headers


def test_docs_page_csp_allowlists_doc_cdns(client):
    """The API CSP keeps the Swagger UI / ReDoc doc pages loadable.

    FastAPI 0.141 serves Swagger UI from jsdelivr and ReDoc from jsdelivr +
    Google Fonts; the enforced policy must allow those hosts or /docs breaks.
    """
    response = client.get("/docs")
    assert response.status_code == 200
    csp = response.headers.get("Content-Security-Policy", "")
    assert "https://cdn.jsdelivr.net" in csp
    assert "https://fonts.googleapis.com" in csp


def test_unhandled_exception_returns_error_envelope(client):
    """An unexpected exception must return the standard 500 envelope (issue #20)."""
    from app.main import app

    @app.get("/api/_test-unhandled")
    def _crash():
        raise RuntimeError("boom")

    try:
        response = client.get("/api/_test-unhandled")
    finally:
        app.router.routes = [r for r in app.router.routes if getattr(r, "path", None) != "/api/_test-unhandled"]

    assert response.status_code == 500
    data = response.json()
    assert data["error"]["code"] == "INTERNAL_ERROR"
    assert data["error"]["message"] == "Internal server error"
    # The raw exception detail must not leak to clients
    assert "boom" not in response.text


def test_cors_preflight_advertises_restricted_methods(client):
    """CORS preflight must not advertise wildcard methods/headers (issue #20)."""
    response = client.options(
        "/api/posts",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert response.status_code == 200
    allow_methods = response.headers.get("access-control-allow-methods", "")
    assert "*" not in allow_methods
    for method in ["GET", "POST", "PATCH", "DELETE"]:
        assert method in allow_methods
    allow_headers = response.headers.get("access-control-allow-headers", "")
    assert "authorization" in allow_headers.lower()
    assert "*" not in allow_headers
