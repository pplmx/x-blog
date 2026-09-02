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


def _create_post(client, auth_headers, slug, published=True, category_id=None, series_id=None, tags=None):
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
    if tags is not None:
        body["tags"] = tags
    resp = client.post("/api/posts", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _tag_id(client, name):
    """Resolve a tag's id from the public /api/tags listing by name."""
    tags = client.get("/api/tags").json()
    for tag in tags:
        if tag["name"] == name:
            return tag["id"]
    raise AssertionError(f"tag {name!r} not found in /api/tags")


def _create_tag(client, auth_headers, name="FeedTag"):
    resp = client.post("/api/tags", json={"name": name}, headers=auth_headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


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

    def test_returns_posts_from_followed_tag(self, client, auth_headers):
        token = _token(client)
        tag_id = _create_tag(client, auth_headers, name="redis")
        _create_post(client, auth_headers, "tag-new", tags=["redis"])
        client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))

        feed = client.get(FOLLOWS_FEED, headers=_auth(token)).json()
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("tag-new-")

    def test_silent_tag_follow_still_tracked_in_feed(self, client, auth_headers):
        """A tag follow with notify off is tracking-only: it feeds the home
        feed but must not fan out a push — tracking vs push are decoupled
        (mirrors category/series, DEC-195)."""
        token = _token(client)
        tag_id = _create_tag(client, auth_headers, name="nginx")
        client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))
        client.patch(
            f"/api/reader/me/tags/{tag_id}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        _create_post(client, auth_headers, "silent-new", tags=["nginx"])

        feed = client.get(FOLLOWS_FEED, headers=_auth(token)).json()
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("silent-new-")

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

    def test_orders_by_effective_publish_time(self, client, auth_headers, db_session):
        """The follows-feed is a feed surface: a post drafted long ago but live
        today leads one drafted-today that went live earlier — effective publish
        at ?? created_at ordering, matching the global feed (RIL ISS-265/267)."""
        from datetime import UTC, datetime, timedelta

        from app import models

        token = _token(client)
        category = _create_category(client, auth_headers)
        client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        sched = _create_post(client, auth_headers, "sched-feed", category_id=category["id"])
        recent = _create_post(client, auth_headers, "recent-feed", category_id=category["id"])

        now = datetime.now(UTC)
        # sched: drafted 30 days ago, scheduled to go live yesterday.
        db_session.query(models.Post).filter(models.Post.id == sched["id"]).update(
            {"created_at": now - timedelta(days=30), "publish_at": now - timedelta(days=1)}
        )
        # recent: actually created 3 days ago, no publish_at.
        db_session.query(models.Post).filter(models.Post.id == recent["id"]).update(
            {"created_at": now - timedelta(days=3)}
        )
        db_session.commit()

        feed = client.get(FOLLOWS_FEED, headers=_auth(token)).json()
        slugs = [p["slug"] for p in feed]
        # Effective publish: sched (yesterday) leads recent (3 days ago).
        # Buggy created_at order put recent first (sched looks 30 days old).
        assert slugs.index(sched["slug"]) < slugs.index(recent["slug"])
