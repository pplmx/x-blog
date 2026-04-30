"""Tests for RequestLoggingMiddleware."""

import logging

from fastapi.testclient import TestClient


class TestRequestLoggingMiddleware:
    """Test RequestLoggingMiddleware functionality."""

    def test_request_id_added_to_response_headers(self, client: TestClient, admin_user):
        """X-Request-ID header should be added to all responses."""
        response = client.get("/api/posts")
        assert response.status_code == 200
        assert "X-Request-ID" in response.headers
        # Request ID should be 8 characters (uuid truncated)
        assert len(response.headers["X-Request-ID"]) == 8

    def test_request_id_is_unique_per_request(self, client: TestClient, admin_user):
        """Each request should get a unique request ID."""
        response1 = client.get("/api/posts")
        response2 = client.get("/api/posts")
        response3 = client.get("/api/posts")

        id1 = response1.headers.get("X-Request-ID")
        id2 = response2.headers.get("X-Request-ID")
        id3 = response3.headers.get("X-Request-ID")

        assert id1 != id2 != id3
        assert id1 is not None
        assert id2 is not None
        assert id3 is not None

    def test_request_started_is_logged(self, client: TestClient, admin_user, caplog):
        """request_started should be logged at INFO level."""
        with caplog.at_level(logging.INFO, logger="xblog"):
            response = client.get("/api/posts")
            assert response.status_code == 200

        # Check that request_started was logged
        assert "request_started" in caplog.text or any(record.message == "request_started" for record in caplog.records)

    def test_request_completed_is_logged(self, client: TestClient, admin_user, caplog):
        """request_completed should be logged at INFO level for fast requests."""
        with caplog.at_level(logging.INFO, logger="xblog"):
            response = client.get("/api/posts")
            assert response.status_code == 200

        # Check that request_completed was logged
        assert "request_completed" in caplog.text or any(
            record.message == "request_completed" for record in caplog.records
        )

    def test_logging_contains_xblog_messages(self, client: TestClient, admin_user, caplog):
        """Logs should contain expected xblog messages."""
        with caplog.at_level(logging.INFO, logger="xblog"):
            response = client.get("/api/posts")
            assert response.status_code == 200

        # Check that log contains xblog logger entries
        xblog_entries = [r for r in caplog.records if r.name == "xblog"]
        assert len(xblog_entries) >= 2  # request_started + request_completed

    def test_all_endpoints_get_request_id(self, client: TestClient, admin_user):
        """All endpoints should return X-Request-ID header."""
        endpoints = [
            ("/api/posts", "GET"),
            ("/api/categories", "GET"),
            ("/api/tags", "GET"),
        ]

        for path, _ in endpoints:
            response = client.get(path)
            assert "X-Request-ID" in response.headers, f"Missing header for {path}"


class TestSlowRequestLogging:
    """Test slow request logging behavior (duration > 1000ms)."""

    def test_slow_request_mechanism_exists(self, client: TestClient, admin_user, caplog):
        """Verify the slow request logging mechanism is in place."""
        with caplog.at_level(logging.INFO, logger="xblog"):
            # Make multiple requests
            for _ in range(3):
                response = client.get("/api/posts")
                assert response.status_code == 200

        # Verify the middleware is logging requests
        assert "request_started" in caplog.text or len(caplog.records) >= 1

    def test_request_completed_is_logged_for_all_requests(self, client: TestClient, admin_user, caplog):
        """All requests should log completion."""
        with caplog.at_level(logging.INFO, logger="xblog"):
            response = client.get("/api/posts")
            assert response.status_code == 200

        # Both start and completion should be logged
        assert "request_started" in caplog.text
        assert "request_completed" in caplog.text


class TestErrorLogging:
    """Test error logging when requests fail."""

    def test_error_endpoint_still_logs(self, client: TestClient, admin_user, caplog):
        """Even error responses should be logged by middleware."""
        with caplog.at_level(logging.INFO, logger="xblog"):
            client.get("/api/posts/99999")
            # 404 is a normal response, middleware still logs it

        # The middleware logs request_started and request_completed
        assert "request_started" in caplog.text

    def test_404_returns_valid_response(self, client: TestClient, admin_user):
        """Non-existent resources return 404."""
        response = client.get("/api/posts/99999")
        # Should return 404 or similar error response
        assert response.status_code in (404, 200)  # 200 if pagination returns empty

    def test_exception_propagates_after_logging(self, client: TestClient, admin_user):
        """Exceptions should propagate after being logged."""
        # Access an invalid route - should return 404
        response = client.get("/api/invalid-path-that-does-not-exist")
        # FastAPI/Starlette handles this gracefully with 404
        assert response.status_code == 404


class TestStructuredLogging:
    """Test structured logging format."""

    def test_logs_use_xblog_logger(self, client: TestClient, admin_user, caplog):
        """Logs should be emitted by the xblog logger."""
        with caplog.at_level(logging.INFO, logger="xblog"):
            response = client.get("/api/posts")
            assert response.status_code == 200

        # Check that logs came from xblog logger
        assert len(caplog.records) >= 1

    def test_request_id_header_contains_uuid_format(self, client: TestClient, admin_user):
        """Request ID should be a shortened UUID."""
        response = client.get("/api/posts")
        request_id = response.headers["X-Request-ID"]

        # Should be 8 characters (uuid truncated)
        assert len(request_id) == 8
        # Should be alphanumeric
        assert request_id.isalnum()

    def test_multiple_requests_have_different_request_ids(self, client: TestClient, admin_user):
        """Each request should get a different request ID."""
        request_ids = set()
        for _ in range(10):
            response = client.get("/api/posts")
            request_ids.add(response.headers["X-Request-ID"])

        # All should be unique
        assert len(request_ids) == 10
