"""Reading-trend analytics contract tests (DEC-086, TASK-155).

- Incrementing views also upserts (and advances) today's post_views_daily row.
- GET /api/admin/stats/views is admin-gated (401 anon, 401 reader token,
  403 non-admin role; editor allowed) and returns a zero-filled last-N-days
  series + the top posts by in-period views (descending).
- days is bounded (422 for 0 or >365).
"""

from sqlalchemy import select

from app import models
from app.auth import User, create_access_token, create_reader_token, get_password_hash
from app.repositories import increment_views


async def _create_post(db_session, slug="analytics-post"):
    from app.repositories import create_post
    from app.schemas import PostCreate

    return await create_post(
        db_session,
        PostCreate(title="Analytics post", slug=slug, content="# Hi", published=True),
    )


class TestDailyUpsert:
    async def test_increment_views_advances_daily_row(self, client, db_session):
        post = await _create_post(db_session)
        await increment_views(db_session, post.id)
        await increment_views(db_session, post.id)
        row = (
            (await db_session.execute(select(models.PostViewsDaily).where(models.PostViewsDaily.post_id == post.id)))
            .scalars()
            .one()
        )
        assert row.views == 2
        # The aggregate counter advanced too.
        await db_session.refresh(post)
        assert post.views == 2

    async def test_view_endpoint_records_daily(self, client, db_session):
        post = await _create_post(db_session)
        for _ in range(3):
            response = await client.post(f"/api/posts/{post.id}/view")
            assert response.status_code == 200, response.text
        row = (
            (await db_session.execute(select(models.PostViewsDaily).where(models.PostViewsDaily.post_id == post.id)))
            .scalars()
            .one()
        )
        assert row.views == 3


class TestViewsStatsEndpoint:
    async def test_series_zero_filled_and_length(self, client, db_session, auth_headers, admin_user):
        await _create_post(db_session, "p1")
        await increment_views(db_session, 1)
        response = await client.get("/api/admin/stats/views?days=7", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["series"]) == 7
        assert data["total"] == 1
        # The one recorded view lands on today.
        assert data["series"][-1]["views"] == 1
        assert all(point["views"] == 0 for point in data["series"][:-1])

    async def test_top_posts_by_in_period_views(self, client, db_session, auth_headers):
        p1 = await _create_post(db_session, "top-a")
        p2 = await _create_post(db_session, "top-b")
        await increment_views(db_session, p1.id)
        await increment_views(db_session, p1.id)
        await increment_views(db_session, p2.id)
        response = await client.get("/api/admin/stats/views", headers=auth_headers)
        assert response.status_code == 200
        top = response.json()["top_posts"]
        assert [t["slug"] for t in top] == ["top-a", "top-b"]
        assert top[0]["views"] == 2 and top[1]["views"] == 1
        assert top[0]["title"] == "Analytics post"

    async def test_large_days_bounded(self, client, auth_headers):
        response = await client.get("/api/admin/stats/views?days=0", headers=auth_headers)
        assert response.status_code == 422
        response = await client.get("/api/admin/stats/views?days=400", headers=auth_headers)
        assert response.status_code == 422


class TestViewsStatsAuth:
    async def test_anonymous_rejected(self, client):
        assert (await client.get("/api/admin/stats/views")).status_code == 401

    async def test_reader_token_rejected(self, client):
        assert (
            await client.get(
                "/api/admin/stats/views",
                headers={"Authorization": f"Bearer {create_reader_token({'sub': 1})}"},
            )
        ).status_code == 401

    async def test_non_admin_role_rejected(self, client, db_session):
        viewer = User(
            username="plainviewer",
            password=get_password_hash("pass12345"),
            role="viewer",
            is_superuser=False,
        )
        db_session.add(viewer)
        await db_session.flush()
        token = create_access_token({"sub": viewer.id}, token_version=viewer.token_version or 0)
        assert (
            await client.get("/api/admin/stats/views", headers={"Authorization": f"Bearer {token}"})
        ).status_code == 403

    async def test_editor_allowed(self, client, editor_headers):
        response = await client.get("/api/admin/stats/views", headers=editor_headers)
        assert response.status_code == 200


class TestPostViewsTrend:
    """Per-post daily series for the editor (DEC-287, TASK-372)."""

    async def test_per_post_series_scoped_and_zero_filled(self, client, db_session, auth_headers):
        p1 = await _create_post(db_session, "trend-a")
        p2 = await _create_post(db_session, "trend-b")
        await increment_views(db_session, p1.id)
        await increment_views(db_session, p1.id)
        await increment_views(db_session, p2.id)
        response = await client.get(f"/api/admin/stats/views/posts/{p1.id}?days=7", headers=auth_headers)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["post_id"] == p1.id
        # Only this post's views are summed — the other post's do not bleed in.
        assert data["total"] == 2
        assert len(data["series"]) == 7
        assert data["series"][-1]["views"] == 2
        assert all(point["views"] == 0 for point in data["series"][:-1])

    async def test_unknown_post_404(self, client, auth_headers):
        response = await client.get("/api/admin/stats/views/posts/999999", headers=auth_headers)
        assert response.status_code == 404

    async def test_days_bounded(self, client, db_session, auth_headers):
        post = await _create_post(db_session, "trend-bounds")
        assert (
            await client.get(f"/api/admin/stats/views/posts/{post.id}?days=0", headers=auth_headers)
        ).status_code == 422
        assert (
            await client.get(f"/api/admin/stats/views/posts/{post.id}?days=400", headers=auth_headers)
        ).status_code == 422

    async def test_admin_gated(self, client, db_session):
        post = await _create_post(db_session, "trend-gate")
        assert (await client.get(f"/api/admin/stats/views/posts/{post.id}")).status_code == 401
