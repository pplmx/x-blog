"""Reader 'latest from your follows' feed tests (DEC-142, TASK-183).

A signed-in reader sees the newest public posts from their followed categories
or series. Covers auth scoping, empty-when-following-nothing, category/series
scoping, dedup, exclusion of non-public posts, and the limit cap.
"""

FOLLOWS_FEED = "/api/reader/me/follows-feed"
_n = 0


def _register(client, email="feed@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="feed@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_category(client, auth_headers, name="FeedCat"):
    global _n
    _n += 1
    resp = client.post("/api/categories", json={"name": f"{name}-{_n}"}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_series(client, auth_headers, slug="feedseries"):
    global _n
    _n += 1
    resp = client.post(
        "/api/series",
        json={"title": f"Feed Series {slug}", "slug": f"{slug}-{_n}", "description": "d"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_post(client, auth_headers, slug, published=True, category_id=None, series_id=None):
    global _n
    _n += 1
    body = {
        "title": f"Feed Post {slug}",
        "slug": f"{slug}-{_n}",
        "content": "content",
        "published": published,
    }
    if category_id is not None:
        body["category_id"] = category_id
    if series_id is not None:
        body["series_id"] = series_id
        body.setdefault("series_order", 0)
    resp = client.post("/api/posts", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestFollowsFeed:
    def test_requires_token(self, client):
        assert client.get(FOLLOWS_FEED).status_code == 401

    def test_empty_when_following_nothing(self, client, auth_headers):
        token = _token(client)
        _create_category(client, auth_headers)
        _create_series(client, auth_headers)
        # reader registered but follows nothing.
        assert client.get(FOLLOWS_FEED, headers=_auth(token)).json() == []

    def test_returns_posts_from_followed_category(self, client, auth_headers):
        token = _token(client)
        category = _create_category(client, auth_headers)
        _create_post(client, auth_headers, "cat-only", category_id=category["id"])
        client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        feed = client.get(FOLLOWS_FEED, headers=_auth(token)).json()
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("cat-only-")

    def test_returns_posts_from_followed_series(self, client, auth_headers):
        token = _token(client)
        series = _create_series(client, auth_headers)
        _create_post(client, auth_headers, "series-only", series_id=series["id"])
        client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        feed = client.get(FOLLOWS_FEED, headers=_auth(token)).json()
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("series-only-")

    def test_dedups_post_in_followed_category_and_series(self, client, auth_headers):
        token = _token(client)
        category = _create_category(client, auth_headers)
        series = _create_series(client, auth_headers)
        _create_post(
            client,
            auth_headers,
            "both",
            category_id=category["id"],
            series_id=series["id"],
        )
        client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))
        client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        feed = client.get(FOLLOWS_FEED, headers=_auth(token)).json()
        assert len(feed) == 1

    def test_excludes_unpublished_posts(self, client, auth_headers):
        token = _token(client)
        category = _create_category(client, auth_headers)
        _create_post(client, auth_headers, "draft", published=False, category_id=category["id"])
        live = _create_post(client, auth_headers, "live", published=True, category_id=category["id"])
        client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        feed = client.get(FOLLOWS_FEED, headers=_auth(token)).json()
        assert [p["slug"] for p in feed] == [live["slug"]]
        assert not any(p["slug"].startswith("draft-") for p in feed)

    def test_respects_limit(self, client, auth_headers):
        token = _token(client)
        category = _create_category(client, auth_headers)
        for i in range(5):
            _create_post(client, auth_headers, f"p{i}", category_id=category["id"])
        client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        feed = client.get(FOLLOWS_FEED + "?limit=3", headers=_auth(token)).json()
        assert len(feed) == 3
