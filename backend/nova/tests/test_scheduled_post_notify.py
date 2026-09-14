"""Contract tests for scheduled-post publish-time fan-out (DEC-336, TASK-394).

A post created as published-but-future ``publish_at`` becomes publicly visible
the moment the clock crosses ``publish_at``, but the create/update fan-outs run
at WRITE time only: create_post fires ``if is_publicly_visible`` (False while
the publish_at is still in the future) and update_post fires once on a
draft->visible transition — so a scheduled post crosses with no push, no
durable inbox row, and no email ever reaching its followers (DEC-076: there is
no background scheduler to notice the crossing).

This suite proves the fire-on-read sweep ``crud.maybe_notify_due_scheduled_posts``
(``new_post_notified_at`` stamp, DEC-336):

- claims a crossed-but-unannounced post exactly once from the public read paths
- performs the same batched fan-out as an immediate publish (durable inbox +
  per-kind kind semantics; push channel fires as well)
- never duplicates on repeat reads (durable stamp is cleared atomically)
- never fires before the crossing, never for drafts/private posts
- never double-fires a post that was announced at write time (immediate publish
  stamps itself so the sweep skips it)
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

NOTIFS = "/api/reader/me/notifications"


def _register(client, email, password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _follow_category(client, token, cat_id):
    resp = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=_auth(token))
    assert resp.status_code in (200, 201), resp.text


def _follow_series(client, token, series_id):
    resp = client.put(f"/api/reader/me/series/{series_id}/follow", headers=_auth(token))
    assert resp.status_code in (200, 201), resp.text


def _create_scheduled_post(client, auth_headers, slug, publish_at, **overrides):
    body = {
        "title": slug,
        "slug": slug,
        "content": "c",
        "excerpt": "e",
        "published": True,
        "publish_at": publish_at.isoformat(),
        **overrides,
    }
    resp = client.post("/api/posts", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _cross_now(db_session, post_id):
    """Fast-forward a scheduled post's publish_at into the past, as if the
    clock had crossed it (server clock is not controllable from the test)."""
    from app import models

    p = db_session.get(models.Post, post_id)
    p.publish_at = (datetime.now(UTC) - timedelta(minutes=1)).replace(tzinfo=None)
    db_session.commit()


def _inbox_total(client, token):
    return client.get(NOTIFS, headers=_auth(token)).json()["total"]


class TestScheduledCrossing:
    def test_crossing_fires_exactly_once_per_follower(self, client, db_session, auth_headers):
        from app import models

        token = _register(client, "sched@example.com").json()["access_token"]
        cat = client.post("/api/categories", json={"name": "Sched"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        _follow_category(client, token, cat_id)

        future = (datetime.now(UTC) + timedelta(days=1)).replace(tzinfo=None)
        post = _create_scheduled_post(client, auth_headers, "sched-cross", future, category_id=cat_id)
        assert _inbox_total(client, token) == 0

        _cross_now(db_session, post["id"])

        # The first public read after the crossing triggers the fan-out.
        assert client.get(f"/api/posts/{post['id']}").status_code == 200
        inbox = client.get(NOTIFS, headers=_auth(token)).json()
        assert inbox["total"] == 1
        assert inbox["items"][0]["kind"] == "new_post"
        assert inbox["items"][0]["url"] == "/posts/sched-cross"

        # The durable stamp persists: a second read fires nothing new.
        assert db_session.get(models.Post, post["id"]).new_post_notified_at is not None
        assert client.get(f"/api/posts/{post['id']}").status_code == 200
        assert _inbox_total(client, token) == 1

    def test_list_path_also_fires_the_sweep(self, client, db_session, auth_headers):
        token = _register(client, "sched-list@example.com").json()["access_token"]
        cat = client.post("/api/categories", json={"name": "SchedL"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        _follow_category(client, token, cat_id)

        future = (datetime.now(UTC) + timedelta(days=1)).replace(tzinfo=None)
        post = _create_scheduled_post(client, auth_headers, "sched-list", future, category_id=cat_id)
        _cross_now(db_session, post["id"])

        assert client.get("/api/posts", params={"limit": 10}).status_code == 200
        assert _inbox_total(client, token) == 1

    def test_series_follow_gets_series_new_part_kind(self, client, db_session, auth_headers):
        token = _register(client, "sched-series@example.com").json()["access_token"]
        series = client.post(
            "/api/series",
            json={"title": "SchedSeries", "slug": "sched-series", "description": "d"},
            headers=auth_headers,
        )
        assert series.status_code == 201, series.text
        _follow_series(client, token, series.json()["id"])

        future = (datetime.now(UTC) + timedelta(days=1)).replace(tzinfo=None)
        post = _create_scheduled_post(client, auth_headers, "sched-s1", future, series_id=series.json()["id"])
        _cross_now(db_session, post["id"])

        assert client.get(f"/api/posts/{post['id']}").status_code == 200
        inbox = client.get(NOTIFS, headers=_auth(token)).json()
        assert inbox["total"] == 1
        assert inbox["items"][0]["kind"] == "series_new_part"
        assert inbox["items"][0]["url"] == "/posts/sched-s1"

    def test_push_channel_fires_at_crossing(self, client, db_session, auth_headers):
        # A reader-bound push subscription with want_new_posts on, no follow
        # needed (all-posts push reaches every subscription).
        _register(client, "sched-push@example.com").json()["access_token"]
        from tests.test_push_new_posts import _subscribe_body

        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))

        future = (datetime.now(UTC) + timedelta(days=1)).replace(tzinfo=None)
        post = _create_scheduled_post(client, auth_headers, "sched-push", future)
        assert client.get(f"/api/posts/{post['id']}").status_code == 404  # invisible before crossing
        _cross_now(db_session, post["id"])

        with patch("app.webpush.send_push") as mock_send:
            assert client.get(f"/api/posts/{post['id']}").status_code == 200

        assert mock_send.call_count == 1
        # Repeat read after the stamp does not push again.
        with patch("app.webpush.send_push") as mock_send2:
            assert client.get(f"/api/posts/{post['id']}").status_code == 200
        assert mock_send2.call_count == 0


class TestNoPrematureFire:
    def test_future_scheduled_fires_nothing_before_crossing(self, client, db_session, auth_headers):
        from app import models

        token = _register(client, "sched-future@example.com").json()["access_token"]
        cat = client.post("/api/categories", json={"name": "SchedF"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        _follow_category(client, token, cat_id)

        future = (datetime.now(UTC) + timedelta(days=1)).replace(tzinfo=None)
        post = _create_scheduled_post(client, auth_headers, "sched-future", future)

        # Invisible to the public and totally silent.
        assert client.get(f"/api/posts/{post['id']}").status_code == 404
        assert client.get("/api/posts", params={"limit": 10}).status_code == 200
        assert _inbox_total(client, token) == 0
        assert db_session.get(models.Post, post["id"]).new_post_notified_at is None

    def test_draft_scheduled_never_fires(self, client, db_session, auth_headers):
        from app import models

        token = _register(client, "sched-draft@example.com").json()["access_token"]
        cat = client.post("/api/categories", json={"name": "SchedD"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        _follow_category(client, token, cat_id)

        past = (datetime.now(UTC) - timedelta(days=1)).replace(tzinfo=None)
        body = {
            "title": "sched-draft",
            "slug": "sched-draft",
            "content": "c",
            "published": False,
            "publish_at": past.isoformat(),
        }
        resp = client.post("/api/posts", json=body, headers=auth_headers)
        assert resp.status_code == 201, resp.text
        post_id = resp.json()["id"]

        # Crossing with published=False stays private: detail 404, sweep silent.
        assert client.get(f"/api/posts/{post_id}").status_code == 404
        assert client.get("/api/posts", params={"limit": 10}).status_code == 200
        assert _inbox_total(client, token) == 0
        assert db_session.get(models.Post, post_id).new_post_notified_at is None


class TestNoDoubleFire:
    def test_immediately_visible_post_stamps_itself_no_double(self, client, db_session, auth_headers):
        """A post that is publicly visible at WRITE time (published with a past
        publish_at = backdated) is announced by create_post immediately — the
        stamp must be set there too, so the crossing sweep later skips it."""
        from app import models

        token = _register(client, "sched-immed@example.com").json()["access_token"]
        cat = client.post("/api/categories", json={"name": "SchedI"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        _follow_category(client, token, cat_id)

        past = (datetime.now(UTC) - timedelta(days=1)).replace(tzinfo=None)
        post = _create_scheduled_post(client, auth_headers, "sched-immed", past, category_id=cat_id)
        assert _inbox_total(client, token) == 1  # immediate fan-out happened

        p = db_session.get(models.Post, post["id"])
        assert p.new_post_notified_at is not None  # stamped so the sweep skips it

        # Reads and the bare sweep must not re-fire.
        assert client.get(f"/api/posts/{post['id']}").status_code == 200
        assert client.get("/api/posts", params={"limit": 10}).status_code == 200
        assert _inbox_total(client, token) == 1

    def test_update_instead_of_create_path_is_not_double_fired(self, client, db_session, auth_headers):
        """A post created as a draft, scheduled-future, then updated to be
        visible-at-write gets the fan-out from update_post (stamped there); a
        subsequent sweep must not re-fire."""
        from app import models

        token = _register(client, "sched-upd@example.com").json()["access_token"]
        cat = client.post("/api/categories", json={"name": "SchedU"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        _follow_category(client, token, cat_id)

        resp = client.post(
            "/api/posts",
            json={"title": "d", "slug": "sched-upd-draft", "content": "c", "published": False, "category_id": cat_id},
            headers=auth_headers,
        )
        post_id = resp.json()["id"]
        # Schedule it for the future while still a draft (no fan-out).
        client.put(
            f"/api/posts/{post_id}",
            json={"published": False, "publish_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()},
            headers=auth_headers,
        )
        assert _inbox_total(client, token) == 0

        # Backdate the schedule (crossing) BEFORE making it public: update_post's
        # transition fires the fan-out now and stamps the post.
        client.put(
            f"/api/posts/{post_id}",
            json={"published": True, "publish_at": (datetime.now(UTC) - timedelta(minutes=1)).isoformat()},
            headers=auth_headers,
        )
        assert _inbox_total(client, token) == 1
        assert db_session.get(models.Post, post_id).new_post_notified_at is not None

        # Sweep and reads do not duplicate.
        assert client.get(f"/api/posts/{post_id}").status_code == 200
        assert client.get("/api/posts", params={"limit": 10}).status_code == 200
        assert _inbox_total(client, token) == 1

    def test_admin_editor_publish_is_stamped_no_double(self, client, db_session, auth_headers):
        """The admin editor's PUT /api/admin/posts/{id} is the front-most publish
        path; it fans out directly (not via crud.update_post), so it must stamp
        the same exactly-once guard — a crossed scheduled post published there
        gets one fan-out, never a second from the fire-on-read sweep."""
        from app import models

        token = _register(client, "sched-admin@example.com").json()["access_token"]
        cat = client.post("/api/categories", json={"name": "SchedA"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        _follow_category(client, token, cat_id)

        resp = client.post(
            "/api/posts",
            json={"title": "d", "slug": "sched-admin-d", "content": "c", "published": False, "category_id": cat_id},
            headers=auth_headers,
        )
        post_id = resp.json()["id"]
        # Schedule it for the future while still a draft (no fan-out).
        client.put(
            f"/api/posts/{post_id}",
            json={"publish_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()},
            headers=auth_headers,
        )
        assert _inbox_total(client, token) == 0
        _cross_now(db_session, post_id)

        # Admin editor publishes the (now crossed) scheduled post: draft->visible
        # transition fans out exactly once and stamps the row.
        resp = client.put(f"/api/admin/posts/{post_id}", json={"published": True}, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert _inbox_total(client, token) == 1
        assert db_session.get(models.Post, post_id).new_post_notified_at is not None

        # Sweep on a public read must not duplicate the admin-editor fan-out.
        assert client.get(f"/api/posts/{post_id}").status_code == 200
        assert client.get("/api/posts", params={"limit": 10}).status_code == 200
        assert _inbox_total(client, token) == 1
