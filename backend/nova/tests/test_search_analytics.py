"""Search-term analytics tests (DEC-152, TASK-188).

Public searches are aggregated (normalized lowercased, count-only) and the
admin sees the top terms; logging is best-effort and never breaks search.
"""

from sqlalchemy import select

SEARCHES = "/api/admin/stats/searches"
_n = 0


async def _create_post(client, auth_headers, title):
    global _n
    _n += 1
    resp = await client.post(
        "/api/posts",
        json={"title": title, "slug": f"sa-{_n}", "content": "content", "published": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestSearchLogging:
    async def test_search_logs_normalized_query(self, client, auth_headers):
        await _create_post(client, auth_headers, "Async Rust Patterns")
        resp = await client.get("/api/search", params={"q": "  Async Rust  "})
        assert resp.status_code == 200

        data = (await client.get(SEARCHES, headers=auth_headers)).json()
        assert any(item["query"] == "async rust" for item in data)

    async def test_repeated_searches_increment_count(self, client, auth_headers):
        await _create_post(client, auth_headers, "Advanced JS")
        for _ in range(3):
            await client.get("/api/search", params={"q": "advanced js"})
            await client.get("/api/search", params={"q": "ADVANCED JS"})

        data = (await client.get(SEARCHES, headers=auth_headers)).json()
        row = next(item for item in data if item["query"] == "advanced js")
        assert row["count"] >= 6

    async def test_empty_when_no_searches(self, client, auth_headers):
        assert (await client.get(SEARCHES, headers=auth_headers)).json() == []

    async def test_crud_logging_exact_counts(self, client, db_session):
        """crud.log_search_query upserts an exact count: first call creates the
        row, every follow-up increments by exactly one — the counter update is
        an atomic SQL expression, never a read-modify-write that can drop
        increments under concurrent searches (round 278).
        """
        from app import crud, models

        await crud.log_search_query(db_session, "async rust")
        await crud.log_search_query(db_session, "async rust")
        await crud.log_search_query(db_session, "  ASYNC RUST  ")  # normalized identically

        (row,) = (
            (await db_session.execute(select(models.SearchLog).where(models.SearchLog.query == "async rust")))
            .scalars()
            .all()
        )
        assert row.count == 3

    async def test_top_searches_ordered_by_count(self, client, auth_headers):
        await _create_post(client, auth_headers, "Common Topic")
        for _ in range(5):
            await client.get("/api/search", params={"q": "common topic"})
        await client.get("/api/search", params={"q": "rare"})

        data = (await client.get(SEARCHES, headers=auth_headers)).json()
        assert data[0]["query"] == "common topic"
        assert data[0]["count"] >= 5


class TestSearchStatsAuth:
    async def test_requires_admin(self, client):
        assert (await client.get(SEARCHES)).status_code == 401

    async def test_editor_allowed(self, client, editor_headers):
        assert (await client.get(SEARCHES, headers=editor_headers)).status_code == 200
