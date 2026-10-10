"""Admin follow-analytics tests (DEC-144, TASK-184).

The operator sees per-series and per-category reader follow counts (tracking,
notify-independent) plus totals on an admin-scoped endpoint.
"""

FOLLOWS_STATS = "/api/admin/stats/follows"
_n = 0


async def _register(client, email="fs@example.com", password="readerpass123"):
    return await client.post("/api/reader/register", json={"email": email, "password": password})


async def _token(client, email="fs@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_category(client, auth_headers, name="StatCat"):
    global _n
    _n += 1
    resp = await client.post("/api/categories", json={"name": f"{name}-{_n}"}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_series(client, auth_headers, slug="statseries"):
    global _n
    _n += 1
    resp = await client.post(
        "/api/series",
        json={"title": f"Stat Series {slug}", "slug": f"{slug}-{_n}", "description": "d"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestFollowStats:
    async def test_requires_admin(self, client):
        assert (await client.get(FOLLOWS_STATS)).status_code == 401

    async def test_reader_token_rejected(self, client):
        token = await _token(client)
        assert (await client.get(FOLLOWS_STATS, headers=_auth(token))).status_code == 401

    async def test_editor_allowed(self, client, editor_headers):
        resp = await client.get(FOLLOWS_STATS, headers=editor_headers)
        assert resp.status_code == 200

    async def test_empty_totals_when_no_follows(self, client, auth_headers):
        resp = await client.get(FOLLOWS_STATS, headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_series_follows"] == 0
        assert data["total_category_follows"] == 0
        assert data["top_series"] == []
        assert data["top_categories"] == []

    async def test_counts_per_category_and_series(self, client, auth_headers):
        cat = await _create_category(client, auth_headers)
        s1 = await _create_series(client, auth_headers, "a")
        s2 = await _create_series(client, auth_headers, "b")

        t1 = await _token(client, email="fs1@example.com")
        await client.put(f"/api/reader/me/categories/{cat['id']}/follow", headers=_auth(t1))
        await client.put(f"/api/reader/me/series/{s1['id']}/follow", headers=_auth(t1))

        t2 = await _token(client, email="fs2@example.com")
        await client.put(f"/api/reader/me/categories/{cat['id']}/follow", headers=_auth(t2))
        await client.put(f"/api/reader/me/series/{s2['id']}/follow", headers=_auth(t2))

        data = (await client.get(FOLLOWS_STATS, headers=auth_headers)).json()
        assert data["total_category_follows"] == 2
        assert data["total_series_follows"] == 2
        assert next(c for c in data["top_categories"] if c["id"] == cat["id"])["count"] == 2
        assert next(s for s in data["top_series"] if s["id"] == s1["id"])["count"] == 1
        assert next(s for s in data["top_series"] if s["id"] == s2["id"])["count"] == 1

    async def test_counts_are_tracking_not_push(self, client, auth_headers):
        # A silent follow (notify=false) still counts towards the audience.
        cat = await _create_category(client, auth_headers)
        token = await _token(client)
        await client.put(f"/api/reader/me/categories/{cat['id']}/follow", headers=_auth(token))
        await client.patch(
            f"/api/reader/me/categories/{cat['id']}/follow",
            json={"notify": False},
            headers=_auth(token),
        )

        data = (await client.get(FOLLOWS_STATS, headers=auth_headers)).json()
        assert data["total_category_follows"] == 1
        assert next(c for c in data["top_categories"] if c["id"] == cat["id"])["count"] == 1
