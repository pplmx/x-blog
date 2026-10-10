"""Reader 'latest from your follows' feed tests (DEC-142, TASK-183).

A signed-in reader sees the newest public posts from their followed categories
or series. Covers auth scoping, empty-when-following-nothing, category/series
scoping, dedup, exclusion of non-public posts, the limit cap, and the paginated
envelope (DEC-292/TASK-375).
"""

from sqlalchemy import update

FOLLOWS_FEED = "/api/reader/me/follows-feed"
_n = 0


def _items(resp):
    """The follows-feed is now a paginated envelope (DEC-292/TASK-375):
    ``{items, pagination}`` instead of a bare list."""
    assert "items" in resp.json()
    assert "pagination" in resp.json()
    return resp.json()["items"]


async def _register(client, email="feed@example.com", password="readerpass123"):
    return await client.post("/api/reader/register", json={"email": email, "password": password})


async def _token(client, email="feed@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_category(client, auth_headers, name="FeedCat"):
    global _n
    _n += 1
    resp = await client.post("/api/categories", json={"name": f"{name}-{_n}"}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_series(client, auth_headers, slug="feedseries"):
    global _n
    _n += 1
    resp = await client.post(
        "/api/series",
        json={"title": f"Feed Series {slug}", "slug": f"{slug}-{_n}", "description": "d"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_post(client, auth_headers, slug, published=True, category_id=None, series_id=None, tags=None):
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
    resp = await client.post("/api/posts", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _tag_id(client, name):
    """Resolve a tag's id from the public /api/tags listing by name."""
    tags = (await client.get("/api/tags")).json()
    for tag in tags:
        if tag["name"] == name:
            return tag["id"]
    raise AssertionError(f"tag {name!r} not found in /api/tags")


async def _create_tag(client, auth_headers, name="FeedTag"):
    resp = await client.post("/api/tags", json={"name": name}, headers=auth_headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


class TestFollowsFeed:
    async def test_requires_token(self, client):
        assert (await client.get(FOLLOWS_FEED)).status_code == 401

    async def test_empty_when_following_nothing(self, client, auth_headers):
        token = await _token(client)
        await _create_category(client, auth_headers)
        await _create_series(client, auth_headers)
        # reader registered but follows nothing.
        assert _items(await client.get(FOLLOWS_FEED, headers=_auth(token))) == []

    async def test_returns_posts_from_followed_category(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        await _create_post(client, auth_headers, "cat-only", category_id=category["id"])
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("cat-only-")

    async def test_returns_posts_from_followed_series(self, client, auth_headers):
        token = await _token(client)
        series = await _create_series(client, auth_headers)
        await _create_post(client, auth_headers, "series-only", series_id=series["id"])
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("series-only-")

    async def test_returns_posts_from_followed_tag(self, client, auth_headers):
        token = await _token(client)
        tag_id = await _create_tag(client, auth_headers, name="redis")
        await _create_post(client, auth_headers, "tag-new", tags=["redis"])
        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("tag-new-")

    async def test_silent_tag_follow_still_tracked_in_feed(self, client, auth_headers):
        """A tag follow with notify off is tracking-only: it feeds the home
        feed but must not fan out a push — tracking vs push are decoupled
        (mirrors category/series, DEC-195)."""
        token = await _token(client)
        tag_id = await _create_tag(client, auth_headers, name="nginx")
        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))
        await client.patch(
            f"/api/reader/me/tags/{tag_id}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        await _create_post(client, auth_headers, "silent-new", tags=["nginx"])

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert len(feed) == 1
        assert feed[0]["slug"].startswith("silent-new-")

    async def test_dedups_post_in_followed_category_and_series(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        series = await _create_series(client, auth_headers)
        await _create_post(
            client,
            auth_headers,
            "both",
            category_id=category["id"],
            series_id=series["id"],
        )
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert len(feed) == 1

    async def test_excludes_unpublished_posts(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        await _create_post(client, auth_headers, "draft", published=False, category_id=category["id"])
        live = await _create_post(client, auth_headers, "live", published=True, category_id=category["id"])
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert [p["slug"] for p in feed] == [live["slug"]]
        assert not any(p["slug"].startswith("draft-") for p in feed)

    async def test_respects_limit(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        for i in range(5):
            await _create_post(client, auth_headers, f"p{i}", category_id=category["id"])
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED + "?limit=3", headers=_auth(token)))
        assert len(feed) == 3

    async def test_orders_by_effective_publish_time(self, client, auth_headers, db_session):
        """The follows-feed is a feed surface: a post drafted long ago but live
        today leads one drafted-today that went live earlier — effective publish
        at ?? created_at ordering, matching the global feed (RIL ISS-265/267)."""
        from datetime import UTC, datetime, timedelta

        from app import models

        token = await _token(client)
        category = await _create_category(client, auth_headers)
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        sched = await _create_post(client, auth_headers, "sched-feed", category_id=category["id"])
        recent = await _create_post(client, auth_headers, "recent-feed", category_id=category["id"])

        now = datetime.now(UTC)
        # sched: drafted 30 days ago, scheduled to go live yesterday.
        (
            await db_session.execute(
                update(models.Post)
                .where(models.Post.id == sched["id"])
                .values({"created_at": now - timedelta(days=30), "publish_at": now - timedelta(days=1)})
            )
        )
        # recent: actually created 3 days ago, no publish_at.
        (
            await db_session.execute(
                update(models.Post)
                .where(models.Post.id == recent["id"])
                .values({"created_at": now - timedelta(days=3)})
            )
        )
        await db_session.commit()

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        slugs = [p["slug"] for p in feed]
        # Effective publish: sched (yesterday) leads recent (3 days ago).
        # Buggy created_at order put recent first (sched looks 30 days old).
        assert slugs.index(sched["slug"]) < slugs.index(recent["slug"])

    # --- Pagination (DEC-292/TASK-375): the envelope carries total/total_pages
    # so the dedicated /follows page can browse past the home cap of 12. ------

    async def test_pagination_envelope_reports_total_and_pages(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        for i in range(5):
            await _create_post(client, auth_headers, f"p{i}", category_id=category["id"])
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        body = (await client.get(FOLLOWS_FEED + "?limit=2", headers=_auth(token))).json()
        assert len(body["items"]) == 2
        assert body["pagination"] == {"total": 5, "page": 1, "limit": 2, "total_pages": 3}

    async def test_pagination_pages_do_not_overlap(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        slugs_created = []
        for i in range(5):
            slugs_created.append(
                (await _create_post(client, auth_headers, f"pg{i}", category_id=category["id"]))["slug"]
            )
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        page1 = [p["slug"] for p in _items(await client.get(FOLLOWS_FEED + "?limit=2&page=1", headers=_auth(token)))]
        page2 = [p["slug"] for p in _items(await client.get(FOLLOWS_FEED + "?limit=2&page=2", headers=_auth(token)))]
        assert len(page1) == 2 and len(page2) == 2
        assert set(page1).isdisjoint(set(page2))

    async def test_pagination_last_page_short_and_out_of_range_empty(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        for i in range(3):
            await _create_post(client, auth_headers, f"r{i}", category_id=category["id"])
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        # limit=2 → page 2 holds the single remainder, total still 3.
        body = (await client.get(FOLLOWS_FEED + "?limit=2&page=2", headers=_auth(token))).json()
        assert len(body["items"]) == 1
        assert body["pagination"]["total"] == 3
        assert body["pagination"]["total_pages"] == 2
        # Beyond the last page: empty items, pagination still reports the real
        # page so the frontend can clamp back into range (archive/search pattern).
        body = (await client.get(FOLLOWS_FEED + "?limit=2&page=99", headers=_auth(token))).json()
        assert body["items"] == []
        assert body["pagination"]["page"] == 99


async def _pen_named_author(db, username="feed-author"):
    """A followable writer: a User with a public pen name (round 353 gate)."""
    from app.auth import User

    u = User(username=username, password="x", role="editor", display_name=f"Pen {username}")
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


class TestFollowsFeedAuthorScope:
    """The follows-feed's author dimension (round 354, DEC-381): a reader
    following a writer sees that writer's public posts, even when none of the
    post's topics are followed — the person-shaped follow pays the same
    discovery payoff as the topic follows."""

    async def test_author_follow_alone_feeds_posts_without_topic_follows(self, client, db_session, auth_headers):
        token = await _token(client)
        author = await _pen_named_author(db_session, "feed-author-a")
        post = await client.post(
            "/api/posts",
            json={
                "title": "authored",
                "slug": f"authored-{author.id}",
                "content": "c",
                "published": True,
                "author_id": author.id,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text
        await client.put(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert len(feed) == 1
        assert feed[0]["slug"] == f"authored-{author.id}"
        assert feed[0]["author"]["id"] == author.id
        assert feed[0]["author"]["display_name"] == "Pen feed-author-a"

    async def test_unrelated_author_posts_stay_out(self, client, db_session, auth_headers):
        token = await _token(client)
        followed = await _pen_named_author(db_session, "feed-author-b")
        other = await _pen_named_author(db_session, "feed-author-c")
        mine = (
            await client.post(
                "/api/posts",
                json={
                    "title": "mine",
                    "slug": f"mine-{followed.id}",
                    "content": "c",
                    "published": True,
                    "author_id": followed.id,
                },
                headers=auth_headers,
            )
        ).json()["slug"]
        await client.post(
            "/api/posts",
            json={
                "title": "theirs",
                "slug": f"theirs-{other.id}",
                "content": "c",
                "published": True,
                "author_id": other.id,
            },
            headers=auth_headers,
        )
        await client.put(f"/api/reader/me/authors/{followed.id}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert [p["slug"] for p in feed] == [mine]

    async def test_dedups_post_matching_author_and_category_follows(self, client, db_session, auth_headers):
        token = await _token(client)
        author = await _pen_named_author(db_session, "feed-author-d")
        category = await _create_category(client, auth_headers, name="CoverBoth")
        post = await client.post(
            "/api/posts",
            json={
                "title": "both-scope",
                "slug": f"both-scope-{author.id}",
                "content": "c",
                "published": True,
                "author_id": author.id,
                "category_id": category["id"],
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text
        await client.put(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(token))
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert len(feed) == 1

    async def test_author_follow_still_respects_publish_visibility(self, client, db_session, auth_headers):
        token = await _token(client)
        author = await _pen_named_author(db_session, "feed-author-e")
        draft = await client.post(
            "/api/posts",
            json={
                "title": "draft-authored",
                "slug": f"draft-authored-{author.id}",
                "content": "c",
                "published": False,
                "author_id": author.id,
            },
            headers=auth_headers,
        )
        assert draft.status_code == 201, draft.text
        await client.put(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(token))

        feed = _items(await client.get(FOLLOWS_FEED, headers=_auth(token)))
        assert feed == []
