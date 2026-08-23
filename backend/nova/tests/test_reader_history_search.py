"""Reader history recall-search tests (DEC-148, TASK-186).

A signed-in reader can filter their past-read posts on /me/history by a term
matching title or excerpt (case-insensitive), publicly-visible only.
"""

_n = 0


def _register(client, email="hist@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="hist@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_post(client, auth_headers, title, slug, excerpt=None):
    global _n
    _n += 1
    resp = client.post(
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


def _record_history(client, token, post_id):
    assert client.post(f"/api/reader/me/history/{post_id}", headers=_auth(token)).status_code == 200


class TestHistorySearch:
    def test_search_matches_title(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "Rust Borrow Checker", "rust")
        _record_history(client, token, p["id"])

        data = client.get("/api/reader/me/history", params={"q": "borrow"}, headers=_auth(token)).json()
        assert data["total"] == 1
        assert data["items"][0]["slug"].startswith("rust-")

    def test_search_matches_excerpt(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "Unrelated Title", "unrelated", excerpt="deep dive into async")
        _record_history(client, token, p["id"])

        data = client.get("/api/reader/me/history", params={"q": "async"}, headers=_auth(token)).json()
        assert data["total"] == 1

    def test_search_case_insensitive(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "FastAPI Deep Dive", "fastapi")
        _record_history(client, token, p["id"])

        data = client.get("/api/reader/me/history", params={"q": "FASTAPI"}, headers=_auth(token)).json()
        assert data["total"] == 1

    def test_search_no_match_returns_empty(self, client, auth_headers):
        token = _token(client)
        p = _create_post(client, auth_headers, "Only Post", "only")
        _record_history(client, token, p["id"])

        data = client.get("/api/reader/me/history", params={"q": "zzznomatch"}, headers=_auth(token)).json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_search_does_not_leak_non_viewed_posts(self, client, auth_headers):
        token = _token(client)
        viewed = _create_post(client, auth_headers, "Viewed Rust", "v")
        _create_post(client, auth_headers, "Other Rust", "o")
        _record_history(client, token, viewed["id"])
        # 'other' is never viewed.

        data = client.get("/api/reader/me/history", params={"q": "rust"}, headers=_auth(token)).json()
        slugs = [i["slug"] for i in data["items"]]
        assert data["total"] == 1
        assert slugs[0].startswith("v-")
        assert not any(slug.startswith("o-") for slug in slugs)

    def test_requires_token(self, client):
        assert client.get("/api/reader/me/history", params={"q": "x"}).status_code == 401
