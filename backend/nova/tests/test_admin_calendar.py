"""Admin editorial-calendar endpoint tests (DEC-162, TASK-194).

The calendar buckets posts into a month grid by their live/scheduled/draft
date so the operator can see the publishing plan at a glance. This suite
covers auth, month validation, type classification (published / scheduled /
draft), an undated draft surfacing under ``unscheduled``, and posts outside
the month being excluded. Follows the other admin-analytics test conventions.
"""

from datetime import timedelta

from app import models
from app.crud import utc_now_naive

CAL = "/api/admin/calendar"


def _month_of(dt) -> str:
    return dt.strftime("%Y-%m")


class TestAuthAndValidation:
    def test_requires_admin(self, client):
        assert client.get(CAL, params={"month": "2026-08"}).status_code == 401

    def test_editor_allowed(self, client, editor_headers):
        assert client.get(CAL, params={"month": "2026-08"}, headers=editor_headers).status_code == 200

    def test_rejects_bad_month_format(self, client, auth_headers):
        assert client.get(CAL, params={"month": "hello"}, headers=auth_headers).status_code == 422

    def test_rejects_invalid_month_value(self, client, auth_headers):
        assert client.get(CAL, params={"month": "2026-13"}, headers=auth_headers).status_code == 400


class TestBucketing:
    def test_published_post_in_current_month(self, client, auth_headers):
        now = utc_now_naive()
        resp = client.post(
            "/api/posts",
            json={"title": "Live now", "slug": "cal-live-now", "content": "x", "published": True},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = client.get(CAL, params={"month": _month_of(now)}, headers=auth_headers).json()
        items = [i for i in data["items"] if i["slug"] == "cal-live-now"]
        assert len(items) == 1
        assert items[0]["type"] == "published"
        assert items[0]["date"].startswith(now.strftime("%Y-%m-%d"))

    def test_scheduled_post_lands_on_its_future_date(self, client, auth_headers):
        future = utc_now_naive() + timedelta(days=3)
        resp = client.post(
            "/api/posts",
            json={
                "title": "Future live",
                "slug": "cal-sched",
                "content": "x",
                "published": True,
                "publish_at": future.isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = client.get(CAL, params={"month": _month_of(future)}, headers=auth_headers).json()
        item = next(i for i in data["items"] if i["slug"] == "cal-sched")
        assert item["type"] == "scheduled"
        assert item["date"].startswith(future.strftime("%Y-%m-%d"))

    def test_draft_with_intended_date_is_draft_on_grid(self, client, auth_headers, db_session):
        future = utc_now_naive() + timedelta(days=5)
        db_session.add(
            models.Post(title="Planned draft", slug="cal-draft", content="x", published=False, publish_at=future)
        )
        db_session.commit()
        data = client.get(CAL, params={"month": _month_of(future)}, headers=auth_headers).json()
        item = next(i for i in data["items"] if i["slug"] == "cal-draft")
        assert item["type"] == "draft"

    def test_undated_draft_is_unscheduled_not_on_grid(self, client, auth_headers, db_session):
        db_session.add(
            models.Post(
                title="No date yet",
                slug="cal-nd",
                content="x",
                published=False,
                publish_at=None,
                created_at=utc_now_naive(),
            )
        )
        db_session.commit()
        data = client.get(CAL, params={"month": _month_of(utc_now_naive())}, headers=auth_headers).json()
        assert "cal-nd" in [i["slug"] for i in data["unscheduled"]]
        assert not any(i["slug"] == "cal-nd" for i in data["items"])

    def test_old_post_excluded_from_current_month(self, client, auth_headers, db_session):
        long_ago = utc_now_naive() - timedelta(days=90)
        db_session.add(
            models.Post(
                title="Old post",
                slug="cal-old",
                content="x",
                published=True,
                publish_at=long_ago,
                created_at=long_ago,
            )
        )
        db_session.commit()
        data = client.get(CAL, params={"month": _month_of(utc_now_naive())}, headers=auth_headers).json()
        assert not any(i["slug"] == "cal-old" for i in data["items"])
