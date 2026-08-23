"""Admin series episode-management tests (DEC-146, TASK-185).

An author can list a series' episodes in order (incl. drafts) and reorder them
via an explicit post-id list; the new order is persisted and reflected in the
public series detail.
"""

_n = 0


def _create_series(client, auth_headers, slug="epseries"):
    global _n
    _n += 1
    resp = client.post(
        "/api/series",
        json={"title": f"Ep Series {slug}", "slug": f"{slug}-{_n}", "description": "d"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_post(client, auth_headers, slug, series_id, order, published=True):
    global _n
    _n += 1
    resp = client.post(
        "/api/posts",
        json={
            "title": f"Ep {slug}",
            "slug": f"{slug}-{_n}",
            "content": "content",
            "published": published,
            "series_id": series_id,
            "series_order": order,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestSeriesEpisodes:
    def test_requires_admin(self, client):
        assert client.get("/api/series/1/episodes").status_code == 401
        assert client.put("/api/series/1/episodes/reorder", json={"post_ids": []}).status_code == 401

    def test_lists_episodes_in_order_including_drafts(self, client, auth_headers):
        series = _create_series(client, auth_headers, "a")
        p1 = _create_post(client, auth_headers, "one", series["id"], 1)
        p2 = _create_post(client, auth_headers, "two", series["id"], 2)
        pd = _create_post(client, auth_headers, "draft", series["id"], 3, published=False)

        resp = client.get(f"/api/series/{series['id']}/episodes", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert [p["id"] for p in data] == [p1["id"], p2["id"], pd["id"]]
        # drafts are included for the author
        assert data[2]["published"] is False

    def test_reorders_episodes(self, client, auth_headers):
        series = _create_series(client, auth_headers, "b")
        p1 = _create_post(client, auth_headers, "one", series["id"], 1)
        p2 = _create_post(client, auth_headers, "two", series["id"], 2)

        resp = client.put(
            f"/api/series/{series['id']}/episodes/reorder",
            json={"post_ids": [p2["id"], p1["id"]]},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert [p["id"] for p in data] == [p2["id"], p1["id"]]
        assert [p["series_order"] for p in data] == [1, 2]

        # Persisted: the admin episode list reflects the new order.
        listed = client.get(f"/api/series/{series['id']}/episodes", headers=auth_headers).json()
        assert [p["id"] for p in listed] == [p2["id"], p1["id"]]

    def test_reorder_requires_post_in_series(self, client, auth_headers):
        series = _create_series(client, auth_headers, "c")
        other = _create_series(client, auth_headers, "d")
        other_post = _create_post(client, auth_headers, "other", other["id"], 1)

        resp = client.put(
            f"/api/series/{series['id']}/episodes/reorder",
            json={"post_ids": [other_post["id"]]},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    def test_reorder_rejects_duplicates(self, client, auth_headers):
        series = _create_series(client, auth_headers, "e")
        p1 = _create_post(client, auth_headers, "one", series["id"], 1)
        resp = client.put(
            f"/api/series/{series['id']}/episodes/reorder",
            json={"post_ids": [p1["id"], p1["id"]]},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    def test_reorder_unknown_series_404(self, client, auth_headers):
        assert (
            client.put(
                "/api/series/999999/episodes/reorder",
                json={"post_ids": []},
                headers=auth_headers,
            ).status_code
            == 404
        )

    def test_reorder_reflected_in_public_series_detail(self, client, auth_headers):
        series = _create_series(client, auth_headers, "f")
        p1 = _create_post(client, auth_headers, "one", series["id"], 1)
        p2 = _create_post(client, auth_headers, "two", series["id"], 2)
        client.put(
            f"/api/series/{series['id']}/episodes/reorder",
            json={"post_ids": [p2["id"], p1["id"]]},
            headers=auth_headers,
        )
        detail = client.get(f"/api/series/{series['slug']}").json()
        assert [p["id"] for p in detail["posts"]] == [p2["id"], p1["id"]]
