"""Conditional-response + cache headers on cacheable public GETs (DEC-058 / TASK-128).

Cacheable public endpoints build their responses via ``app.conditional``: a
200 carries a strong ETag + ``Cache-Control: public, max-age=60``, and a
matching ``If-None-Match`` revalidation returns a 304 without a body. The same
ETag must be stable across an in-memory cache hit/miss so revalidation works.
"""

import pytest

PUBLIC_CACHE_CONTROL = "public, max-age=60"


def _etag_of(response) -> str | None:
    return response.headers.get("etag")


def test_posts_list_has_etag_cache_control_and_304(client, auth_headers):
    created = client.post(
        "/api/posts",
        json={"title": "Cond", "slug": "cond-list", "content": "C", "published": True},
        headers=auth_headers,
    )
    assert created.status_code == 201

    first = client.get("/api/posts")
    assert first.status_code == 200
    etag = _etag_of(first)
    assert etag
    assert first.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL

    second = client.get("/api/posts")
    assert second.status_code == 200
    assert _etag_of(second) == etag, "ETag must be stable across cache hit"

    not_modified = client.get("/api/posts", headers={"If-None-Match": etag})
    assert not_modified.status_code == 304
    assert not_modified.content == b""
    assert _etag_of(not_modified) == etag


def test_archive_is_conditional(client):
    response = client.get("/api/posts/archive")
    assert response.status_code == 200
    etag = _etag_of(response)
    assert etag
    assert response.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL
    assert client.get("/api/posts/archive", headers={"If-None-Match": etag}).status_code == 304


def test_popular_related_adjacent_are_conditional(client, auth_headers):
    created = client.post(
        "/api/posts",
        json={"title": "Pop", "slug": "cond-pop", "content": "C", "published": True},
        headers=auth_headers,
    )
    post_id = created.json()["id"]
    for path in ("/api/posts/popular/list", f"/api/posts/{post_id}/related", f"/api/posts/{post_id}/adjacent"):
        response = client.get(path)
        assert response.status_code == 200, path
        etag = _etag_of(response)
        assert etag, path
        assert response.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL, path
        assert client.get(path, headers={"If-None-Match": etag}).status_code == 304, path


def test_categories_and_tags_are_conditional(client, auth_headers):
    client.post("/api/categories", json={"name": "CondCat"}, headers=auth_headers)
    client.post("/api/tags", json={"name": "CondTag"}, headers=auth_headers)

    for path in ("/api/categories", "/api/tags"):
        response = client.get(path)
        assert response.status_code == 200
        etag = _etag_of(response)
        assert etag
        assert response.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL
        not_modified = client.get(path, headers={"If-None-Match": etag})
        assert not_modified.status_code == 304

    categories = client.get("/api/categories").json()
    assert categories, "expected the created category to be listed"
    cat_id = categories[0]["id"]
    response = client.get(f"/api/categories/{cat_id}")
    assert response.status_code == 200
    assert _etag_of(response)
    assert response.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL


def test_series_list_and_detail_are_conditional(client, auth_headers):
    created = client.post(
        "/api/series",
        json={"title": "Cond Series", "slug": "cond-series", "description": "d"},
        headers=auth_headers,
    )
    assert created.status_code == 201
    # Assign a post to the series so the detail has content.
    post = client.post(
        "/api/posts",
        json={
            "title": "SeriesPost",
            "slug": "cond-sp",
            "content": "C",
            "published": True,
            "series_id": created.json()["id"],
        },
        headers=auth_headers,
    )
    assert post.status_code == 201

    for path in ("/api/series", "/api/series/cond-series"):
        response = client.get(path)
        assert response.status_code == 200
        etag = _etag_of(response)
        assert etag
        assert response.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL
        assert client.get(path, headers={"If-None-Match": etag}).status_code == 304


def test_feed_304_now_carries_cache_control(client):
    """Feeds keep their ETag/304 (TASK-089) and now also set Cache-Control so
    the earlier TASK-129 no-store default cannot neuter feed caching."""
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    etag = _etag_of(response)
    assert etag
    assert response.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL
    not_modified = client.get("/rss/feed.xml", headers={"If-None-Match": etag})
    assert not_modified.status_code == 304
    assert not_modified.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL


@pytest.mark.parametrize(
    "path",
    [
        "/rss/feed.xml",
        "/rss/atom.xml",
        "/sitemap.xml",
        "/api/posts",
        "/api/series",
        "/api/categories",
        "/api/tags",
        "/api/posts/archive",
    ],
)
def test_conditional_responses_never_store(client, path):
    """Every cacheable conditional response must still respect If-None-Match
    (200 -> 304) end to end; this is a smoke that the helper wires correctly
    across the router families."""
    response = client.get(path)
    etag = _etag_of(response)
    assert etag, f"expected an ETag on {path}"
    assert response.headers.get("Cache-Control") == PUBLIC_CACHE_CONTROL, path
    assert client.get(path, headers={"If-None-Match": etag}).status_code == 304, path
