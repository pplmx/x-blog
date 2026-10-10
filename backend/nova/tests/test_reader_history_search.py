"""Reader history recall-search tests (DEC-148, TASK-186).

A signed-in reader can filter their past-read posts on /me/history by a term
matching title or excerpt (case-insensitive), publicly-visible only.
"""

_n = 0


async def _register(client, email="hist@example.com", password="readerpass123"):
    return await client.post("/api/reader/register", json={"email": email, "password": password})


async def _token(client, email="hist@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_post(client, auth_headers, title, slug, excerpt=None):
    global _n
    _n += 1
    resp = await client.post(
        "/api/posts",
        json={
            "title": title,
            "slug": f"{slug}-{_n}",
            "content": "body",
            "published": True,
            "excerpt": excerpt,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _record_history(client, token, post_id):
    assert (await client.post(f"/api/reader/me/history/{post_id}", headers=_auth(token))).status_code == 200


class TestHistorySearch:
    async def test_search_matches_title(self, client, auth_headers):
        token = await _token(client)
        p = await _create_post(client, auth_headers, "Rust Borrow Checker", "rust")
        await _record_history(client, token, p["id"])

        data = (await client.get("/api/reader/me/history", params={"q": "borrow"}, headers=_auth(token))).json()
        assert data["total"] == 1
        assert data["items"][0]["slug"].startswith("rust-")

    async def test_search_matches_excerpt(self, client, auth_headers):
        token = await _token(client)
        p = await _create_post(client, auth_headers, "Unrelated Title", "unrelated", excerpt="deep dive into async")
        await _record_history(client, token, p["id"])

        data = (await client.get("/api/reader/me/history", params={"q": "async"}, headers=_auth(token))).json()
        assert data["total"] == 1

    async def test_search_case_insensitive(self, client, auth_headers):
        token = await _token(client)
        p = await _create_post(client, auth_headers, "FastAPI Deep Dive", "fastapi")
        await _record_history(client, token, p["id"])

        data = (await client.get("/api/reader/me/history", params={"q": "FASTAPI"}, headers=_auth(token))).json()
        assert data["total"] == 1

    async def test_search_no_match_returns_empty(self, client, auth_headers):
        token = await _token(client)
        p = await _create_post(client, auth_headers, "Only Post", "only")
        await _record_history(client, token, p["id"])

        data = (await client.get("/api/reader/me/history", params={"q": "zzznomatch"}, headers=_auth(token))).json()
        assert data["total"] == 0
        assert data["items"] == []

    async def test_search_does_not_leak_non_viewed_posts(self, client, auth_headers):
        token = await _token(client)
        viewed = await _create_post(client, auth_headers, "Viewed Rust", "v")
        await _create_post(client, auth_headers, "Other Rust", "o")
        await _record_history(client, token, viewed["id"])
        # 'other' is never viewed.

        data = (await client.get("/api/reader/me/history", params={"q": "rust"}, headers=_auth(token))).json()
        slugs = [i["slug"] for i in data["items"]]
        assert data["total"] == 1
        assert slugs[0].startswith("v-")
        assert not any(slug.startswith("o-") for slug in slugs)

    async def test_requires_token(self, client):
        assert (await client.get("/api/reader/me/history", params={"q": "x"})).status_code == 401

    async def test_overlong_q_is_422_not_burned_into_an_iliike_bind(self, client, auth_headers):
        # /me/history is not rate-limited and its q reached the ILIKE bind with
        # no length cap; bound it to the public search's MAX_QUERY_LENGTH so an
        # oversized term is a clean 422 instead of a large %..% pattern on the
        # reader's history rows (round-296 deep-dive).
        token = await _token(client)
        response = await client.get("/api/reader/me/history", params={"q": "x" * 201}, headers=_auth(token))
        assert response.status_code == 422
