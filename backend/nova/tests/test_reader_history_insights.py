"""Reader reading-insights tests (DEC-417, TASK-434).

A signed-in reader gets a "what and how much" view of their reading on
`/me/history/insights` — distinct publicly-visible posts read all-time and in
the trailing 30 days, plus the most-read categories. Complements the
streak/heatmap (calendar shape) with the content shape. Public-visibility
invariant: un-published/scheduled posts neither leak nor count.
"""

from datetime import UTC, timedelta

INSIGHTS = "/api/reader/me/history/insights"


def _register(client, email="insights@example.com"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123"},
    )


def _token(client, **kw):
    return _register(client, **kw).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _create_post(db_session, *, title="Readable post", category_id=None, published=True, **overrides):
    """Create a post directly via crud (bypasses the admin API for brevity)."""
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return create_post(
        db_session,
        PostCreate(
            title=title,
            slug=f"insights-{_slug_counter}",
            content="# Hello\n\nWorld",
            published=published,
            category_id=category_id,
            **overrides,
        ),
    )


def _create_category(db_session, name):
    from app.crud import create_category
    from app.schemas import CategoryCreate

    return create_category(db_session, CategoryCreate(name=name))


def _record_history(client, token, post_id):
    assert client.post(f"/api/reader/me/history/{post_id}", headers=_auth(token)).status_code == 200


def _backdate_history(db_session, post_id, days_ago):
    """Push a history row's viewed_at back so it falls outside the 30-day window."""
    from datetime import datetime as dt

    from app import models

    row = (
        db_session.query(models.ReadingHistory)
        .filter(models.ReadingHistory.post_id == post_id)
        .order_by(models.ReadingHistory.id.desc())
        .first()
    )
    assert row is not None
    row.viewed_at = dt.now(UTC) - timedelta(days=days_ago)
    db_session.commit()


class TestInsightsAuth:
    def test_requires_reader_token(self, client):
        resp = client.get(INSIGHTS)
        assert resp.status_code == 401


class TestInsightsContent:
    def test_empty_history_returns_zeroes(self, client, db_session):
        token = _token(client)
        data = client.get(INSIGHTS, headers=_auth(token)).json()
        assert data["grand_total"] == 0
        assert data["last_30_days"] == 0
        assert data["top_categories"] == []

    def test_grand_total_counts_distinct_viewed_posts(self, client, db_session):
        token = _token(client)
        p1 = _create_post(db_session)
        p2 = _create_post(db_session)
        _record_history(client, token, p1.id)
        _record_history(client, token, p2.id)

        data = client.get(INSIGHTS, headers=_auth(token)).json()
        assert data["grand_total"] == 2
        # Repeat views on the same post still count once.
        _record_history(client, token, p1.id)
        data = client.get(INSIGHTS, headers=_auth(token)).json()
        assert data["grand_total"] == 2

    def test_last_30_days_counts_only_recent_views(self, client, db_session):
        token = _token(client)
        recent = _create_post(db_session)
        old = _create_post(db_session)
        _record_history(client, token, recent.id)
        _record_history(client, token, old.id)
        _backdate_history(db_session, old.id, days_ago=60)

        data = client.get(INSIGHTS, headers=_auth(token)).json()
        assert data["grand_total"] == 2
        assert data["last_30_days"] == 1

    def test_top_categories_by_distinct_reads(self, client, db_session):
        token = _token(client)
        cat_a = _create_category(db_session, "Rust")
        cat_b = _create_category(db_session, "Baking")
        p1 = _create_post(db_session, category_id=cat_a.id)
        p2 = _create_post(db_session, category_id=cat_a.id)
        p3 = _create_post(db_session, category_id=cat_b.id)
        for p in (p1, p2, p3):
            _record_history(client, token, p.id)

        data = client.get(INSIGHTS, headers=_auth(token)).json()
        assert data["grand_total"] == 3
        cats = {c["name"]: c["count"] for c in data["top_categories"]}
        assert cats == {"Rust": 2, "Baking": 1}
        # Most-read first.
        assert data["top_categories"][0]["name"] == "Rust"

    def test_unpublished_posts_neither_leak_nor_count(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        cat = _create_category(db_session, "Public")
        live = _create_post(db_session, title="Live", category_id=cat.id)
        vanishing = _create_post(db_session, title="Vanishing", category_id=cat.id)
        _record_history(client, token, live.id)
        _record_history(client, token, vanishing.id)
        # The reader read both, then one of them became a draft.
        update_post(db_session, vanishing.id, PostUpdate(published=False))

        data = client.get(INSIGHTS, headers=_auth(token)).json()
        assert data["grand_total"] == 1
        assert data["top_categories"] == [{"name": "Public", "count": 1}]

    def test_posts_without_category_are_counted_but_not_categorized(self, client, db_session):
        token = _token(client)
        cat = _create_category(db_session, "Rust")
        p1 = _create_post(db_session, category_id=cat.id)
        p2 = _create_post(db_session)  # no category
        for p in (p1, p2):
            _record_history(client, token, p.id)

        data = client.get(INSIGHTS, headers=_auth(token)).json()
        assert data["grand_total"] == 2
        assert data["top_categories"] == [{"name": "Rust", "count": 1}]
