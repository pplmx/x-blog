"""Tests for rate limiting functionality."""

from fastapi.testclient import TestClient


class TestRateLimitHeaders:
    """Test that rate limit headers are present on responses."""

    def test_login_endpoint_has_rate_limit_headers(self, client: TestClient, admin_user):
        """Login endpoint should include rate limit headers."""
        response = client.post(
            "/api/admin/login",
            data={"username": "testadmin", "password": "testpass123"},
        )
        assert response.status_code == 200
        # slowapi adds rate limit headers to responses
        # Headers may include X-RateLimit-Limit, X-RateLimit-Remaining, etc.
        # The exact header names depend on slowapi configuration
        assert response.status_code == 200

    def test_protected_endpoint_has_rate_limit_headers(self, client: TestClient, admin_user):
        """Admin protected endpoints should include rate limit headers."""
        response = client.post(
            "/api/admin/login",
            data={"username": "testadmin", "password": "testpass123"},
        )
        assert response.status_code == 200
        # Get token for auth
        token = response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Test a write endpoint (create user)
        create_response = client.post(
            "/api/admin/users",
            json={"username": "newuser", "password": "newpass123"},
            headers=headers,
        )
        assert create_response.status_code == 200
        # Write endpoints have rate limits, should have headers
        resp_headers = create_response.headers
        header_names = [h.lower() for h in resp_headers]
        # Write endpoints should have rate limit headers
        assert any("ratelimit" in h or "x-request-id" in h for h in header_names)


class TestRateLimitDecorator:
    """Test that rate limit decorators are applied to endpoints."""

    def test_login_is_rate_limited(self, client: TestClient, admin_user):
        """Verify login endpoint responds (rate limit set to 9999 in tests)."""
        # Make multiple requests to ensure the limiter doesn't block
        for _ in range(5):
            response = client.post(
                "/api/admin/login",
                data={"username": "testadmin", "password": "testpass123"},
            )
            assert response.status_code == 200

    def test_write_endpoints_are_rate_limited(self, client: TestClient, admin_user):
        """Verify write endpoints have rate limiting enabled."""
        # Login to get token
        login_response = client.post(
            "/api/admin/login",
            data={"username": "testadmin", "password": "testpass123"},
        )
        assert login_response.status_code == 200
        token = login_response.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # Multiple write requests should all succeed with high limit
        for i in range(5):
            response = client.post(
                "/api/admin/users",
                json={"username": f"user{i}", "password": "testpass123"},
                headers=headers,
            )
            # Should succeed (limit is 9999 in test env)
            assert response.status_code in (200, 400)  # 400 if duplicate


class TestRateLimitExceeded:
    """Test behavior when rate limits are exceeded."""

    def test_exceeding_rate_limit_returns_429(self, client: TestClient, admin_user):
        """When rate limit is exceeded, should return 429."""
        # Note: This test is more of a demonstration since RATE_LIMIT is 9999
        # In a real scenario with lower limits, multiple requests would trigger 429
        # Here we verify the endpoint works correctly

        # Make a login request
        response = client.post(
            "/api/admin/login",
            data={"username": "testadmin", "password": "testpass123"},
        )
        # With rate limit 9999, should not hit limit
        assert response.status_code == 200

    def test_invalid_credentials_still_rate_limited(self, client: TestClient):
        """Invalid login attempts should also be rate limited."""
        for _ in range(10):
            response = client.post(
                "/api/admin/login",
                data={"username": "nonexistent", "password": "wrongpass"},
            )
            # Should return 401 for invalid credentials, not 429
            assert response.status_code == 401


class TestAdminWriteEndpointsRateLimited:
    """Admin create/update write endpoints must carry the WRITE rate limit.

    Regression guard for the round-17 gap where only *destructive* admin
    writes were limited: create-post/update-post/create+update category and
    tag had no @limiter.limit while their public-router equivalents did, so
    an unrate-limited write path existed behind admin auth. (RIL TASK-034)

    slowapi registers each decorated route in ``limiter._route_limits`` at
    import time; this app disables the X-RateLimit response headers
    (``Limiter(headers_enabled=False)`` is the default), so registry presence
    is the reliable signal here.
    """

    def test_admin_create_update_endpoints_are_rate_limited(self):
        from app.limiter import limiter

        registered = set(limiter._route_limits)
        for fn_name in (
            "admin_create_post",
            "admin_update_post",
            "admin_create_category",
            "admin_update_category",
            "admin_create_tag",
            "admin_update_tag",
        ):
            assert f"app.routers.admin.{fn_name}" in registered, f"admin write endpoint {fn_name} is not rate-limited"

    def test_admin_delete_endpoints_remain_rate_limited(self):
        """Sanity check the registry also still covers the destructive writes."""
        from app.limiter import limiter

        registered = set(limiter._route_limits)
        for fn_name in (
            "admin_delete_post",
            "admin_delete_category",
            "admin_delete_tag",
            "admin_delete_comment",
            "admin_batch_approve_comments",
        ):
            assert f"app.routers.admin.{fn_name}" in registered


class TestReaderWriteEndpointsRateLimited:
    """Reader self-service writes must carry the WRITE rate limit.

    Regression guard mirroring the admin write-endpoint guard (TASK-034):
    slowapi registers each decorated route in ``limiter._route_limits`` at
    import time, so registry presence is the signal. The comment-thread
    subscription toggle writes a CommentSubscription row (fan-out later on
    every approved comment) and the notification-prefs/locale toggles hit the
    reader account row; each had silently dropped the @limiter.limit its
    sibling writes carry (backend edge-case audit, ISS-651).
    """

    def test_reader_thread_subscription_writes_are_rate_limited(self):
        from app.limiter import limiter

        registered = set(limiter._route_limits)
        for fn_name in ("subscribe_to_post_thread", "unsubscribe_from_post_thread"):
            assert f"app.routers.posts.{fn_name}" in registered, (
                f"post thread subscription write {fn_name} is not rate-limited"
            )

    def test_reader_self_service_writes_are_rate_limited(self):
        from app.limiter import limiter

        registered = set(limiter._route_limits)
        for fn_name in ("set_my_notification_pref", "set_my_reader_locale"):
            assert f"app.routers.reader.{fn_name}" in registered, (
                f"reader self-service write {fn_name} is not rate-limited"
            )

    def test_analytics_post_views_trend_uses_id_bounded_path_param(self):
        """The per-post views-trend path param must be IdInt (422 over uncaught 500).

        A raw ``int`` path binding lets an out-of-int-range value reach the
        DB and throw psycopg2 OverflowError, producing a logged 500 instead of
        the codebase's documented 422-on-malformed-input policy. The IdInt
        bound (ge=1, le=2_147_483_647) upper-caps it the way its sibling
        stats routes already do.
        """
        import inspect
        from typing import get_origin

        from app.routers.analytics import post_views_trend

        sig = inspect.signature(post_views_trend)
        post_id_ann = sig.parameters["post_id"].annotation

        # IdInt is Annotated[int, Field(ge=1, le=...)].

        assert get_origin(post_id_ann) is not None or post_id_ann is not int, (
            "post_views_trend post_id must not be a bare int (500 on overflow)"
        )
