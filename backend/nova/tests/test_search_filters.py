"""Search filters + sort contract tests (DEC-084, TASK-154).

Adds category/tag/date-range narrowing and sort (relevance/newest/oldest/
views) to /api/search. Key properties:

- category/tag filter by NAME (unknown name → empty result, no error).
- date_from/date_to bound created_at (naive-UTC coercion: an aware ISO
  datetime works and never hits a PG tz-mismatch).
- sort=newest/oldest/views reorder deterministically on the dialect-agnostic
  substring path; sort=relevance on a non-tsvector (SQLite / CJK) query
  degrades to newest. Invalid sort is a 422.
- Filters compose with the keyword term (AND semantics).
"""

from datetime import UTC, datetime, timedelta

from app import models, schemas
from app.crud import create_post

BASE = "/api/search"


def _seed_search_blog(db_session):
    """Three posts across categories/tags/dates for deterministic filtering."""
    tech = models.Category(name="技术")
    life = models.Category(name="生活")
    db_session.add_all([tech, life])
    py_tag = models.Tag(name="python")
    life_tag = models.Tag(name="随笔")
    db_session.add_all([py_tag, life_tag])
    db_session.flush()
    now = datetime.now(UTC)

    p1 = create_post(
        db_session,
        schemas.PostCreate(title="python 异步 实践", slug="py-async", content="# python asyncio 实践", published=True),
    )
    p1.category = tech
    p1.tags = [py_tag]
    p1.views = 100
    p1.likes = 30
    p1.created_at = now - timedelta(days=3)

    p2 = create_post(
        db_session,
        schemas.PostCreate(title="python 数据 可视化", slug="py-viz", content="# python 数据可视化", published=True),
    )
    p2.category = tech
    p2.tags = [py_tag]
    p2.views = 200
    p2.likes = 5
    p2.created_at = now - timedelta(days=1)

    p3 = create_post(
        db_session,
        schemas.PostCreate(title="今天的随笔", slug="today-life", content="# 一篇生活随笔", published=True),
    )
    p3.category = life
    p3.tags = [life_tag]
    p3.views = 50
    p3.likes = 1
    p3.created_at = now  # newest

    db_session.flush()
    return {"p1": p1, "p2": p2, "p3": p3, "py_tag": py_tag}


def _slugs(resp):
    assert resp.status_code == 200, resp.text
    return [p["slug"] for p in resp.json()["items"]]


class TestSearchFilters:
    def test_filter_by_category_name(self, client, db_session):
        _seed_search_blog(db_session)
        assert set(_slugs(client.get(BASE, params={"q": "python", "category": "技术"}))) == {
            "py-async",
            "py-viz",
        }

    def test_unknown_category_yields_empty(self, client, db_session):
        _seed_search_blog(db_session)
        assert _slugs(client.get(BASE, params={"q": "python", "category": "不存在"})) == []

    def test_filter_by_tag_name(self, client, db_session):
        _seed_search_blog(db_session)
        # "python" appears only in the two tech posts, none of which carries
        # the 随笔 tag → tag + keyword compose with AND → empty.
        assert _slugs(client.get(BASE, params={"q": "python", "tag": "随笔"})) == []

    def test_tag_matches_life_post(self, client, db_session):
        _seed_search_blog(db_session)
        assert _slugs(client.get(BASE, params={"q": "随笔", "tag": "随笔"})) == ["today-life"]

    def test_filter_by_date_range_with_aware_input(self, client, db_session):
        now = datetime.now(UTC)
        _seed_search_blog(db_session)
        # Created within the last 2 days; the from/to are tz-aware ISO strings —
        # the route must coerce to naive-UTC for the column comparison.
        resp = client.get(
            BASE,
            params={
                "q": "python",
                "date_from": (now - timedelta(days=2)).isoformat(),
                "date_to": now.isoformat(),
            },
        )
        assert _slugs(resp) == ["py-viz"]

    def test_category_plus_keyword_composes(self, client, db_session):
        _seed_search_blog(db_session)
        assert _slugs(client.get(BASE, params={"q": "随笔", "category": "生活"})) == ["today-life"]


class TestSearchSort:
    def test_sort_views(self, client, db_session):
        _seed_search_blog(db_session)
        assert _slugs(client.get(BASE, params={"q": "python", "sort": "views"})) == ["py-viz", "py-async"]

    def test_sort_oldest(self, client, db_session):
        _seed_search_blog(db_session)
        assert _slugs(client.get(BASE, params={"q": "python", "sort": "oldest"})) == ["py-async", "py-viz"]

    def test_sort_newest(self, client, db_session):
        _seed_search_blog(db_session)
        assert _slugs(client.get(BASE, params={"q": "python", "sort": "newest"})) == ["py-viz", "py-async"]

    def test_relevance_degrades_to_newest_without_tsvector(self, client, db_session):
        # SQLite has no tsvector, so "relevance" falls back to newest order.
        # PostgreSQL ranks with ts_rank over the seeded content (py-async
        # consistently outranks py-viz there), so assert per dialect.
        _seed_search_blog(db_session)
        is_pg = db_session.get_bind().dialect.name == "postgresql"
        expected = ["py-async", "py-viz"] if is_pg else ["py-viz", "py-async"]
        assert _slugs(client.get(BASE, params={"q": "python", "sort": "relevance"})) == expected

    def test_invalid_sort_rejected(self, client, db_session):
        resp = client.get(BASE, params={"q": "python", "sort": "bogus"})
        assert resp.status_code == 422


class TestDateOnlyInclusiveBounds:
    """Date-only (YYYY-MM-DD) bounds must be inclusive of the chosen day.

    <input type="date"> always submits date-only strings. The old behavior
    parsed date_to=2026-09-01 as midnight and filtered created_at <= that
    midnight, silently dropping every post published later the same day the
    reader picked. A date-only bound must mean "the whole day"."""

    def test_date_to_dateonly_includes_same_day_posts(self, client, db_session):
        now = _seed_search_blog(db_session)["p3"].created_at.replace(tzinfo=None)
        day = now.strftime("%Y-%m-%d")
        # p3 (today-life) is created at `now` (today's real time, not midnight).
        resp = client.get(BASE, params={"q": "随笔", "date_to": day})
        assert resp.status_code == 200, resp.text
        assert "today-life" in _slugs(resp)

    def test_date_from_dateonly_excludes_previous_day(self, client, db_session):
        # p2 (py-viz) is 1 day old; p1 (py-async) is 3 days old.
        now = datetime.now(UTC)
        _seed_search_blog(db_session)
        start_day = (now - timedelta(days=2)).strftime("%Y-%m-%d")
        # From 2 days ago (00:00) with an open end: p1 (3 days ago) excluded,
        # p2 (1 day ago) and p3 (today) included.
        resp = client.get(BASE, params={"q": "python", "date_from": start_day})
        assert set(_slugs(resp)) == {"py-viz"}

    def test_date_to_full_iso_bound_unchanged(self, client, db_session):
        now = datetime.now(UTC)
        _seed_search_blog(db_session)
        # A full ISO date_to with a time part keeps exact-bound semantics.
        resp = client.get(
            BASE,
            params={
                "q": "python",
                "date_to": (now - timedelta(days=2) - timedelta(seconds=1)).isoformat(),
            },
        )
        assert resp.status_code == 200
        assert "py-viz" not in _slugs(resp)

    def test_malformed_date_bound_rejected(self, client, db_session):
        _seed_search_blog(db_session)
        resp = client.get(BASE, params={"q": "python", "date_to": "not-a-date"})
        assert resp.status_code == 422

    def test_aware_datetime_from_still_works(self, client, db_session):
        now = datetime.now(UTC)
        _seed_search_blog(db_session)
        # Full tz-aware ISO datetime must keep working through the raw-string
        # boundary (naive-UTC coercion).
        resp = client.get(
            BASE,
            params={
                "q": "python",
                "date_from": (now - timedelta(days=2)).isoformat(),
                "date_to": now.isoformat(),
            },
        )
        assert set(_slugs(resp)) == {"py-viz"}
