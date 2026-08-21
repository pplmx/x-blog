"""Reading-trend analytics contract tests (DEC-086, TASK-155).

- Incrementing views also upserts (and advances) today's post_views_daily row.
- GET /api/admin/stats/views is admin-gated (401 anon, 401 reader token,
  403 non-admin role; editor allowed) and returns a zero-filled last-N-days
  series + the top posts by in-period views (descending).
- days is bounded (422 for 0 or >365).
"""

from app import models
from app.auth import User, create_access_token, create_reader_token, get_password_hash
from app.crud import increment_views


def _create_post(db_session, slug="analytics-post"):
    from app.crud import create_post
    from app.schemas import PostCreate

    return create_post(
        db_session,
        PostCreate(title="Analytics post", slug=slug, content="# Hi", published=True),
    )


class TestDailyUpsert:
    def test_increment_views_advances_daily_row(self, client, db_session):
        post = _create_post(db_session)
        increment_views(db_session, post.id)
        increment_views(db_session, post.id)
        row = db_session.query(models.PostViewsDaily).filter_by(post_id=post.id).one()
        assert row.views == 2
        # The aggregate counter advanced too.
        db_session.refresh(post)
        assert post.views == 2

    def test_view_endpoint_records_daily(self, client, db_session):
        post = _create_post(db_session)
        for _ in range(3):
            response = client.post(f"/api/posts/{post.id}/view")
            assert response.status_code == 200, response.text
        row = db_session.query(models.PostViewsDaily).filter_by(post_id=post.id).one()
        assert row.views == 3


class TestViewsStatsEndpoint:
    def test_series_zero_filled_and_length(self, client, db_session, auth_headers, admin_user):
        _create_post(db_session, "p1")
        increment_views(db_session, 1)
        response = client.get("/api/admin/stats/views?days=7", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["series"]) == 7
        assert data["total"] == 1
        # The one recorded view lands on today.
        assert data["series"][-1]["views"] == 1
        assert all(point["views"] == 0 for point in data["series"][:-1])

    def test_top_posts_by_in_period_views(self, client, db_session, auth_headers):
        p1 = _create_post(db_session, "top-a")
        p2 = _create_post(db_session, "top-b")
        increment_views(db_session, p1.id)
        increment_views(db_session, p1.id)
        increment_views(db_session, p2.id)
        response = client.get("/api/admin/stats/views", headers=auth_headers)
        assert response.status_code == 200
        top = response.json()["top_posts"]
        assert [t["slug"] for t in top] == ["top-a", "top-b"]
        assert top[0]["views"] == 2 and top[1]["views"] == 1
        assert top[0]["title"] == "Analytics post"

    def test_large_days_bounded(self, client, auth_headers):
        response = client.get("/api/admin/stats/views?days=0", headers=auth_headers)
        assert response.status_code == 422
        response = client.get("/api/admin/stats/views?days=400", headers=auth_headers)
        assert response.status_code == 422


class TestViewsStatsAuth:
    def test_anonymous_rejected(self, client):
        assert client.get("/api/admin/stats/views").status_code == 401

    def test_reader_token_rejected(self, client):
        assert (
            client.get(
                "/api/admin/stats/views",
                headers={"Authorization": f"Bearer {create_reader_token({'sub': 1})}"},
            ).status_code
            == 401
        )

    def test_non_admin_role_rejected(self, client, db_session):
        viewer = User(
            username="plainviewer",
            password=get_password_hash("pass12345"),
            role="viewer",
            is_superuser=False,
        )
        db_session.add(viewer)
        db_session.flush()
        token = create_access_token({"sub": viewer.id}, token_version=viewer.token_version or 0)
        assert client.get("/api/admin/stats/views", headers={"Authorization": f"Bearer {token}"}).status_code == 403

    def test_editor_allowed(self, client, editor_headers):
        response = client.get("/api/admin/stats/views", headers=editor_headers)
        assert response.status_code == 200
