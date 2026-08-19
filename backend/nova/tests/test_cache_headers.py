"""Cache-policy middleware (RIL DEC-058 / TASK-129).

Every API response defaults to ``Cache-Control: no-store`` unless the route
explicitly set its own ``Cache-Control`` (the cacheable public list/feed
endpoints opt in via routers/conditional.py in TASK-128). Private admin data,
write-on-read view/like counters, the live-counters post detail, search and
comments must never reach a shared cache.
"""


def test_admin_endpoints_are_no_store(client, auth_headers):
    response = client.get("/api/admin/posts", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store"


def test_post_detail_is_no_store(client, auth_headers):
    # The detail response carries live views/likes; shared caches must not
    # store it or every client would see stale counters.
    created = client.post(
        "/api/posts",
        json={"title": "Detail", "slug": "detail-no-store", "content": "C", "published": True},
        headers=auth_headers,
    )
    assert created.status_code == 201
    response = client.get("/api/posts/detail-no-store")
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store"


def test_write_on_read_view_posts_is_no_store(client, auth_headers):
    created = client.post(
        "/api/posts",
        json={"title": "View", "slug": "view-no-store", "content": "C", "published": True},
        headers=auth_headers,
    )
    post_id = created.json()["id"]
    response = client.post(f"/api/posts/{post_id}/view")
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store"


def test_search_is_no_store(client):
    response = client.get("/api/search", params={"q": "x"})
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store"


def test_comments_list_is_no_store(client, auth_headers):
    created = client.post(
        "/api/posts",
        json={"title": "Comments", "slug": "comments-no-store", "content": "C", "published": True},
        headers=auth_headers,
    )
    post_id = created.json()["id"]
    response = client.get(f"/api/comments/post/{post_id}")
    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "no-store"


def test_no_store_applies_to_error_responses(client):
    response = client.get("/api/posts/999999")
    assert response.status_code == 404
    assert response.headers.get("Cache-Control") == "no-store"


def test_route_set_cache_control_is_preserved_by_middleware(client):
    """A route that declares its own Cache-Control opts out of the no-store default."""
    from fastapi.responses import Response

    from app.main import app

    @app.get("/api/_test-cache")
    def _cacheable():
        return Response(content="ok", media_type="text/plain", headers={"Cache-Control": "public, max-age=60"})

    try:
        response = client.get("/api/_test-cache")
    finally:
        app.router.routes = [r for r in app.router.routes if getattr(r, "path", None) != "/api/_test-cache"]

    assert response.status_code == 200
    assert response.headers.get("Cache-Control") == "public, max-age=60"
