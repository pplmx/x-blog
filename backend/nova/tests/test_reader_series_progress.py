"""Reader series reading-progress contract tests (DEC-122, TASK-173).

A signed-in reader's progress through a series is derived from their server
reading history: episodes already in the history count as read, `next_slug` is
the first unread post in series order, and the series is "completed" when every
public episode is read. Auth-scoped and isolated per reader.
"""

HISTORY = "/api/reader/me/history"


async def _register(client, email="series@example.com", password="readerpass123"):
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


async def _token(client, email="series@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_series(client, auth_headers, title="Tutorial Series", slug="tutorial-series"):
    return await client.post(
        "/api/series",
        json={"title": title, "slug": slug, "description": "An ordered tutorial set"},
        headers=auth_headers,
    )


async def _create_post(client, auth_headers, title, slug, series_id, series_order):
    return await client.post(
        "/api/posts",
        json={
            "title": title,
            "slug": slug,
            "content": "# Hello",
            "published": True,
            "series_id": series_id,
            "series_order": series_order,
        },
        headers=auth_headers,
    )


async def _series_with_posts(client, admin_headers, prefix="ep"):
    series = await _create_series(client, admin_headers)
    sid = series.json()["id"]
    slug = series.json()["slug"]
    posts = []
    for i in range(3):
        p = await _create_post(client, admin_headers, f"{prefix}{i}", f"{prefix}{i}-slug", sid, i)
        assert p.status_code == 201, p.text
        posts.append(p.json())
    return slug, posts


async def _progress(client, token, slug):
    return await client.get(f"/api/reader/me/series/{slug}/progress", headers=_auth(token))


class TestAuthRequired:
    async def test_progress_requires_reader_token(self, client):
        assert (await client.get("/api/reader/me/series/tutorial-series/progress")).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        resp = await client.get("/api/reader/me/series/tutorial-series/progress", headers=headers)
        assert resp.status_code == 401


class TestSeriesProgress:
    async def test_unknown_series_404(self, client):
        token = await _token(client)
        assert (await _progress(client, token, "nope")).status_code == 404

    async def test_empty_progress_uses_series_order(self, client, auth_headers):
        token = await _token(client)
        slug, posts = await _series_with_posts(client, auth_headers)
        body = (await _progress(client, token, slug)).json()
        assert body["total"] == 3
        assert body["read_count"] == 0
        assert body["completed"] is False
        assert body["read_post_ids"] == []
        # next is the first episode in series order.
        assert body["next_slug"] == posts[0]["slug"]

    async def test_partial_progress(self, client, auth_headers):
        token = await _token(client)
        slug, posts = await _series_with_posts(client, auth_headers)
        # Read episode 0 and 2; episode 1 stays unread.
        await client.post(f"{HISTORY}/{posts[0]['id']}", headers=_auth(token))
        await client.post(f"{HISTORY}/{posts[2]['id']}", headers=_auth(token))
        body = (await _progress(client, token, slug)).json()
        assert body["read_count"] == 2
        assert set(body["read_post_ids"]) == {posts[0]["id"], posts[2]["id"]}
        assert body["next_slug"] == posts[1]["slug"]
        assert body["completed"] is False

    async def test_complete_when_all_read(self, client, auth_headers):
        token = await _token(client)
        slug, posts = await _series_with_posts(client, auth_headers)
        for p in posts:
            await client.post(f"{HISTORY}/{p['id']}", headers=_auth(token))
        body = (await _progress(client, token, slug)).json()
        assert body["read_count"] == 3
        assert body["next_slug"] is None
        assert body["completed"] is True

    async def test_progress_isolated_between_readers(self, client, auth_headers):
        t1 = await _token(client, email="iso1@example.com")
        t2 = await _token(client, email="iso2@example.com")
        slug, posts = await _series_with_posts(client, auth_headers)
        await client.post(f"{HISTORY}/{posts[0]['id']}", headers=_auth(t1))
        assert (await _progress(client, t1, slug)).json()["read_count"] == 1
        assert (await _progress(client, t2, slug)).json()["read_count"] == 0

    async def test_draft_episode_excluded(self, client, auth_headers):
        # A draft episode is not in the series' visible set, so it neither
        # counts toward total nor blocks completion.
        token = await _token(client)
        series = await _create_series(client, auth_headers, title="Drafty", slug="drafty-series")
        sid = series.json()["id"]
        visible = await _create_post(client, auth_headers, "Visible", "visible-ep", sid, 0)
        await client.post(
            "/api/posts",
            json={
                "title": "Draft",
                "slug": "draft-ep",
                "content": "# H",
                "published": False,
                "series_id": sid,
                "series_order": 1,
            },
            headers=auth_headers,
        )
        # Mark the (only) visible episode read.
        await client.post(f"{HISTORY}/{visible.json()['id']}", headers=_auth(token))
        body = (await _progress(client, token, "drafty-series")).json()
        assert body["total"] == 1
        assert body["read_count"] == 1
        assert body["completed"] is True

    async def test_scheduled_future_episode_excluded(self, client, auth_headers):
        from datetime import UTC, datetime, timedelta

        token = await _token(client)
        series = await _create_series(client, auth_headers, title="Future", slug="future-series")
        sid = series.json()["id"]
        await _create_post(client, auth_headers, "Now", "now-ep", sid, 0)
        future = await client.post(
            "/api/posts",
            json={
                "title": "Later",
                "slug": "later-ep",
                "content": "# H",
                "published": True,
                "series_id": sid,
                "series_order": 1,
                "publish_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
            },
            headers=auth_headers,
        )
        # Reading the future episode is rejected (not publicly visible yet).
        assert (await client.post(f"{HISTORY}/{future.json()['id']}", headers=_auth(token))).status_code == 404
        body = (await _progress(client, token, "future-series")).json()
        assert body["total"] == 1
