"""Per-category / per-series RSS feed contract tests (DEC-130, TASK-177).

Scoped feeds reuse the RSS builder: /rss/category/{name}.xml (category has no
slug — unique name is the stable segment) and /rss/series/{slug}.xml. Each
returns only the publicly-visible posts in that scope, a scoped channel title,
and 404 for unknown category/series.
"""

from sqlalchemy import select


async def _category(db, name):
    from app.models import Category

    c = (await db.execute(select(Category).where(Category.name == name))).scalars().first()
    if not c:
        c = Category(name=name)
        db.add(c)
        await db.commit()
        await db.refresh(c)
    return c


_slug_counter = 0


async def _post(db, title, category=None):
    from app.repositories import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return await create_post(
        db,
        PostCreate(
            title=title,
            slug=f"scoped-{_slug_counter}",
            content="# Hello\n\nWorld",
            category_id=category.id if category else None,
            published=True,
        ),
    )


async def _series(db, slug="tutorial-series"):
    from app.models import Series

    series = (await db.execute(select(Series).where(Series.slug == slug))).scalars().first()
    if not series:
        series = Series(title="Tutorial Series", slug=slug, description="An ordered set")
        db.add(series)
        await db.commit()
        await db.refresh(series)
    return series


class TestCategoryFeed:
    async def test_returns_only_category_posts_and_scoped_title(self, client, db_session):
        ai = await _category(db_session, "AI")
        dev = await _category(db_session, "DevOps")
        ai1 = await _post(db_session, "AI One", category=ai)
        ai2 = await _post(db_session, "AI Two", category=ai)
        await _post(db_session, "Dev Post", category=dev)

        resp = await client.get("/rss/category/AI.xml")
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("application/rss+xml")
        body = resp.text
        assert "AI —" in body  # scoped channel title
        assert f"<![CDATA[{ai1.title}]]>" in body
        assert f"<![CDATA[{ai2.title}]]>" in body
        assert "<![CDATA[Dev Post]]>" not in body

    async def test_unknown_category_404(self, client):
        assert (await client.get("/rss/category/nope.xml")).status_code == 404

    async def test_url_encoded_category_name(self, client, db_session):
        await _category(db_session, "Deep Dive")
        resp = await client.get("/rss/category/Deep%20Dive.xml")
        assert resp.status_code == 200, resp.text


class TestSeriesFeed:
    async def test_returns_only_series_posts_and_scoped_title(self, client, db_session):
        series = await _series(db_session)
        s1 = await _post(db_session, "Part One")
        s2 = await _post(db_session, "Part Two")
        outside = await _post(db_session, "Outside")
        await _add_to_series(db_session, s1, series, 0)
        await _add_to_series(db_session, s2, series, 1)

        resp = await client.get("/rss/series/tutorial-series.xml")
        assert resp.status_code == 200, resp.text
        body = resp.text
        assert "Tutorial Series —" in body
        assert f"<![CDATA[{s1.title}]]>" in body
        assert f"<![CDATA[{s2.title}]]>" in body
        assert f"<![CDATA[{outside.title}]]>" not in body

    async def test_unknown_series_404(self, client):
        assert (await client.get("/rss/series/nope.xml")).status_code == 404


async def _add_to_series(db, post, series, order):
    post.series_id = series.id
    post.series_order = order
    await db.commit()
    await db.refresh(post)
