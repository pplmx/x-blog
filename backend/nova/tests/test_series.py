"""Post series contract tests (DEC-056, TASK-121).

Cover the series surface end to end: admin CRUD, slug uniqueness, public
list/detail with ordered visible posts, draft/scheduled exclusion, series
assignment + reorder + clear via post create/update, cache invalidation on
series and post writes, and unlink-on-delete semantics.
"""


def _create_series(client, auth_headers, title="Tutorial Series", slug="tutorial-series"):
    return client.post(
        "/api/series",
        json={"title": title, "slug": slug, "description": "An ordered tutorial set"},
        headers=auth_headers,
    )


def _create_post(
    client,
    auth_headers,
    title,
    slug,
    series_id=None,
    series_order=0,
    published=True,
    publish_at=None,
):
    payload = {
        "title": title,
        "slug": slug,
        "content": "# Hello",
        "published": published,
        "series_id": series_id,
        "series_order": series_order,
    }
    if publish_at is not None:
        payload["publish_at"] = publish_at
    return client.post("/api/posts", json=payload, headers=auth_headers)


# --- Admin CRUD ----------------------------------------------------------


def test_create_series(client, auth_headers):
    resp = _create_series(client, auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "Tutorial Series"
    assert data["slug"] == "tutorial-series"
    assert data["description"] == "An ordered tutorial set"
    assert "id" in data


def test_create_series_requires_auth(client):
    resp = client.post("/api/series", json={"title": "X", "slug": "x", "description": None})
    assert resp.status_code == 401


def test_create_series_duplicate_slug(client, auth_headers):
    _create_series(client, auth_headers)
    resp = _create_series(client, auth_headers)
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "BAD_REQUEST"


def test_create_series_invalid_slug(client, auth_headers):
    resp = client.post(
        "/api/series",
        json={"title": "Bad", "slug": "Bad Slug!", "description": None},
        headers=auth_headers,
    )
    assert resp.status_code == 422


def test_update_series(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    resp = client.put(
        f"/api/series/{series['id']}",
        json={"title": "Renamed", "slug": "renamed-series", "description": "new"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Renamed"
    assert data["slug"] == "renamed-series"
    # public list follows the rename
    resp = client.get("/api/series")
    slogs = [s["slug"] for s in resp.json()]
    assert "renamed-series" in slogs and "tutorial-series" not in slogs


def test_update_series_missing(client, auth_headers):
    resp = client.put(
        "/api/series/9999",
        json={"title": "Nope", "slug": "nope", "description": None},
        headers=auth_headers,
    )
    assert resp.status_code == 404


# --- Public read paths ---------------------------------------------------


def test_list_series(client, auth_headers):
    _create_series(client, auth_headers)
    _create_series(client, auth_headers, title="Another", slug="another-series")
    resp = client.get("/api/series")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    for s in data:
        assert "post_count" in s
        assert isinstance(s["post_count"], int)
    assert {s["slug"] for s in data} == {"tutorial-series", "another-series"}


def test_series_list_post_count_visible_only(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    _create_post(client, auth_headers, "Pub", "pub", series["id"], 0)
    _create_post(client, auth_headers, "Draft", "draft", series["id"], 1, published=False)
    data = client.get("/api/series").json()
    match = [s for s in data if s["slug"] == series["slug"]][0]
    assert match["post_count"] == 1


def test_get_series_not_found(client):
    assert client.get("/api/series/does-not-exist").status_code == 404


def test_series_detail_orders_published_posts(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    _create_post(client, auth_headers, "Part 1", "part-1", series["id"], 0)
    _create_post(client, auth_headers, "Part 3", "part-3", series["id"], 2)
    _create_post(client, auth_headers, "Part 2", "part-2", series["id"], 1)
    data = client.get(f"/api/series/{series['slug']}").json()
    assert [p["slug"] for p in data["posts"]] == ["part-1", "part-2", "part-3"]
    assert data["post_count"] == 3


def test_series_detail_excludes_drafts_and_scheduled(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    _create_post(client, auth_headers, "Pub", "pub", series["id"], 0)
    _create_post(client, auth_headers, "Draft", "draft", series["id"], 1, published=False)
    _create_post(
        client,
        auth_headers,
        "Future",
        "future",
        series["id"],
        2,
        publish_at="2099-01-01T00:00:00",
    )
    data = client.get(f"/api/series/{series['slug']}").json()
    assert [p["slug"] for p in data["posts"]] == ["pub"]
    assert data["post_count"] == 1


# --- Series <-> Post wiring ----------------------------------------------


def test_post_detail_includes_series(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    post = _create_post(client, auth_headers, "Part 1", "part-1", series["id"], 0).json()
    detail = client.get(f"/api/posts/{post['id']}").json()
    assert detail["series"] == {
        "id": series["id"],
        "title": "Tutorial Series",
        "slug": "tutorial-series",
    }
    assert detail["series_order"] == 0


def test_create_post_with_unknown_series_rejected(client, auth_headers):
    resp = client.post(
        "/api/posts",
        json={
            "title": "X",
            "slug": "x",
            "content": "c",
            "published": True,
            "series_id": 9999,
            "series_order": 0,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 400


def test_clear_series_assignment_via_null(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    post = _create_post(client, auth_headers, "Part 1", "part-1", series["id"], 0).json()
    resp = client.put(
        f"/api/posts/{post['id']}",
        json={"series_id": None, "series_order": 0},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    detail = client.get(f"/api/posts/{post['id']}").json()
    assert detail["series"] is None
    # removing the only post empties the series detail
    assert client.get(f"/api/series/{series['slug']}").status_code == 200


def test_delete_series_unlinks_posts(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    post = _create_post(client, auth_headers, "Part 1", "part-1", series["id"], 0).json()
    resp = client.delete(f"/api/series/{series['id']}", headers=auth_headers)
    assert resp.status_code == 204
    detail = client.get(f"/api/posts/{post['id']}").json()
    assert detail["series"] is None


# --- Cache invalidation --------------------------------------------------


def test_series_cache_invalidated_on_post_write(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    _create_post(client, auth_headers, "Part 1", "part-1", series["id"], 0)
    first = client.get(f"/api/series/{series['slug']}").json()
    assert [p["slug"] for p in first["posts"]] == ["part-1"]
    # add a post — the cached detail must drop
    _create_post(client, auth_headers, "Part 2", "part-2", series["id"], 1)
    second = client.get(f"/api/series/{series['slug']}").json()
    assert [p["slug"] for p in second["posts"]] == ["part-1", "part-2"]


def test_series_cache_invalidated_on_series_update(client, auth_headers):
    series = _create_series(client, auth_headers).json()
    client.get(f"/api/series/{series['slug']}")  # warm cache
    client.put(
        f"/api/series/{series['id']}",
        json={"title": "Renamed", "slug": "renamed-series", "description": "new"},
        headers=auth_headers,
    )
    resp = client.get("/api/series/renamed-series")
    assert resp.status_code == 200
    assert resp.json()["title"] == "Renamed"
    # old slug is gone from both cache and DB
    assert client.get("/api/series/tutorial-series").status_code == 404


def test_series_cache_invalidated_on_counter_bump(client, auth_headers):
    """A pageview/like must bust the cached SERIES detail, not just the posts
    list: the detail embeds the same PostList views/likes (rendered per-episode
    on series/[slug].vue), so without clearing series_cache a hot series served
    pre-bump counters for the full 300s TTL while the feed updated instantly
    (deep-dive review, ISS-373)."""
    series = _create_series(client, auth_headers).json()
    post = _create_post(client, auth_headers, "Part 1", "part-1", series["id"], 0).json()

    # Warm the series-detail cache with the pre-bump counters.
    first = client.get(f"/api/series/{series['slug']}").json()
    assert first["posts"][0]["views"] == 0

    # Bump the post's view counter (public pageview endpoint).
    bumped = client.post(f"/api/posts/{post['id']}/view").json()
    assert bumped["views"] == 1

    # The series detail must recompute — not serve the cached pre-bump payload.
    second = client.get(f"/api/series/{series['slug']}").json()
    assert second["posts"][0]["views"] == 1
