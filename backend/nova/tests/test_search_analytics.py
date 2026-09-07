"""Search-term analytics tests (DEC-152, TASK-188).

Public searches are aggregated (normalized lowercased, count-only) and the
admin sees the top terms; logging is best-effort and never breaks search.
"""

SEARCHES = "/api/admin/stats/searches"
_n = 0


def _create_post(client, auth_headers, title):
    global _n
    _n += 1
    resp = client.post(
        "/api/posts",
        json={"title": title, "slug": f"sa-{_n}", "content": "content", "published": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestSearchLogging:
    def test_search_logs_normalized_query(self, client, auth_headers):
        _create_post(client, auth_headers, "Async Rust Patterns")
        resp = client.get("/api/search", params={"q": "  Async Rust  "})
        assert resp.status_code == 200

        data = client.get(SEARCHES, headers=auth_headers).json()
        assert any(item["query"] == "async rust" for item in data)

    def test_repeated_searches_increment_count(self, client, auth_headers):
        _create_post(client, auth_headers, "Advanced JS")
        for _ in range(3):
            client.get("/api/search", params={"q": "advanced js"})
            client.get("/api/search", params={"q": "ADVANCED JS"})

        data = client.get(SEARCHES, headers=auth_headers).json()
        row = next(item for item in data if item["query"] == "advanced js")
        assert row["count"] >= 6

    def test_empty_when_no_searches(self, client, auth_headers):
        assert client.get(SEARCHES, headers=auth_headers).json() == []

    def test_crud_logging_exact_counts(self, client, db_session):
        """crud.log_search_query upserts an exact count: first call creates the
        row, every follow-up increments by exactly one — the counter update is
        an atomic SQL expression, never a read-modify-write that can drop
        increments under concurrent searches (round 278).
        """
        from app import crud, models

        crud.log_search_query(db_session, "async rust")
        crud.log_search_query(db_session, "async rust")
        crud.log_search_query(db_session, "  ASYNC RUST  ")  # normalized identically

        (row,) = db_session.query(models.SearchLog).filter(models.SearchLog.query == "async rust").all()
        assert row.count == 3

    def test_top_searches_ordered_by_count(self, client, auth_headers):
        _create_post(client, auth_headers, "Common Topic")
        for _ in range(5):
            client.get("/api/search", params={"q": "common topic"})
        client.get("/api/search", params={"q": "rare"})

        data = client.get(SEARCHES, headers=auth_headers).json()
        assert data[0]["query"] == "common topic"
        assert data[0]["count"] >= 5


class TestSearchStatsAuth:
    def test_requires_admin(self, client):
        assert client.get(SEARCHES).status_code == 401

    def test_editor_allowed(self, client, editor_headers):
        assert client.get(SEARCHES, headers=editor_headers).status_code == 200
