"""Contract tests for new-post Web Push notifications (DEC-076, TASK-147).

Covers:
- subscribe carries want_new_posts / new_post_category_id prefs (defaults False/None,
  unknown category -> 422, resubscribe upserts prefs).
- publishing a post fans out to opted-in subscriptions only, scoped by
  followed category (category match, category-less posts reach only
  all-posts subscribers), with dead-endpoint retirement and fail-closed
  behaviour when VAPID is unconfigured.
- the fan-out fires only on the draft/scheduled -> published transition
  (create-as-published, or an update that makes the post visible), never
  on draft creation, scheduled future posts, or edits of already-published
  posts.
"""

import base64
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from app import webpush

ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/AAAAAAAAAAAAAAAAAAAA"
OTHER = "https://fcm.googleapis.com/fcm/send/BBBBBBBBBBBBBBBBBBBBBBBB"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _subscribe_body(endpoint: str = ENDPOINT, prefix: int = 4, **extra) -> dict:
    point = b"\x04" + bytes([prefix] * 32) + bytes([prefix + 1] * 32)
    keys = {"p256dh": _b64url(point), "auth": _b64url(bytes([prefix]) * 16)}
    return {"endpoint": endpoint, "keys": keys, **extra}


def _create_category(client, auth_headers, name: str) -> int:
    resp = client.post("/api/categories", json={"name": name, "slug": name.lower()}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_post(client, auth_headers, slug: str = "np-post", **payload) -> None:
    body = {
        "title": f"T {slug}",
        "slug": slug,
        "content": "content",
        "excerpt": "excerpt",
        "published": True,
        **payload,
    }
    resp = client.post("/api/posts", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text


def _update_post(client, auth_headers, post_id: int, **payload) -> None:
    resp = client.put(f"/api/posts/{post_id}", json=payload, headers=auth_headers)
    assert resp.status_code == 200, resp.text


class TestSubscribePrefs:
    def test_defaults_to_off(self, client, db_session):
        from app import models

        client.post("/api/push/subscribe", json=_subscribe_body())
        row = db_session.query(models.PushSubscription).one()
        assert row.want_new_posts is False
        assert row.new_post_category_id is None

    def test_stores_new_post_prefs(self, client, db_session, auth_headers):
        from app import models

        cat_id = _create_category(client, auth_headers, "推送分类")
        client.post(
            "/api/push/subscribe",
            json=_subscribe_body(want_new_posts=True, new_post_category_id=cat_id),
        )
        row = db_session.query(models.PushSubscription).one()
        assert row.want_new_posts is True
        assert row.new_post_category_id == cat_id

    def test_rejects_unknown_category(self, client):
        resp = client.post(
            "/api/push/subscribe",
            json=_subscribe_body(want_new_posts=True, new_post_category_id=999999),
        )
        assert resp.status_code == 422

    def test_resubscribe_upserts_prefs(self, client, db_session, auth_headers):
        from app import models

        cat_id = _create_category(client, auth_headers, "再订阅")
        client.post("/api/push/subscribe", json=_subscribe_body())
        first = db_session.query(models.PushSubscription).one().id
        client.post(
            "/api/push/subscribe",
            json=_subscribe_body(want_new_posts=True, new_post_category_id=cat_id),
        )
        assert db_session.query(models.PushSubscription).count() == 1
        row = db_session.query(models.PushSubscription).one()
        assert row.id == first
        assert row.want_new_posts is True
        assert row.new_post_category_id == cat_id


class TestPublishFanOut:
    def test_publishes_to_opted_in_only(self, client, auth_headers, db_session):
        # One all-posts subscriber, one who never opted in.
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))
        client.post("/api/push/subscribe", json=_subscribe_body(endpoint=OTHER, prefix=8))

        captured = []
        with patch("app.webpush.send_push") as mock_send:
            mock_send.side_effect = lambda **kw: captured.append(kw["payload"])
            _create_post(client, auth_headers, slug="np-only-opted")

        assert mock_send.call_count == 1
        assert captured[0]["title"] == webpush.POST_NOTIF_TITLE
        assert captured[0]["url"] == "/posts/np-only-opted"

    def test_category_scope_matches_only_followed_category(self, client, auth_headers, db_session):
        cat_a = _create_category(client, auth_headers, "A类")
        cat_b = _create_category(client, auth_headers, "B类")
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True, new_post_category_id=cat_a))
        client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint=OTHER, prefix=8, want_new_posts=True, new_post_category_id=cat_b),
        )

        with patch("app.webpush.send_push") as mock_send:
            _create_post(client, auth_headers, slug="in-cat-a", category_id=cat_a)
        assert mock_send.call_count == 1
        call = mock_send.call_args.kwargs["payload"]
        assert call["url"] == "/posts/in-cat-a"

    def test_category_scope_also_receives_from_all_posts_subscriber(self, client, auth_headers):
        cat_a = _create_category(client, auth_headers, "C类")
        # Followed-category (cat_a) + a global all-posts subscriber.
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True, new_post_category_id=cat_a))
        client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint=OTHER, prefix=8, want_new_posts=True),
        )

        with patch("app.webpush.send_push") as mock_send:
            _create_post(client, auth_headers, slug="in-cat-c", category_id=cat_a)
        assert mock_send.call_count == 2

    def test_category_less_post_reaches_only_all_posts_subscribers(self, client, auth_headers):
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True, new_post_category_id=777))
        client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint=OTHER, prefix=8, want_new_posts=True),
        )

        with patch("app.webpush.send_push") as mock_send:
            _create_post(client, auth_headers, slug="no-category")
        assert mock_send.call_count == 1
        assert mock_send.call_args.kwargs["payload"]["url"] == "/posts/no-category"

    def test_draft_create_does_not_notify(self, client, auth_headers):
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))
        with patch("app.webpush.send_push") as mock_send:
            _create_post(client, auth_headers, slug="draft", published=False)
        assert mock_send.call_count == 0

    def test_scheduled_future_post_does_not_notify(self, client, auth_headers):
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))
        future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
        with patch("app.webpush.send_push") as mock_send:
            _create_post(client, auth_headers, slug="scheduled", publish_at=future)
        assert mock_send.call_count == 0

    def test_draft_to_published_transition_notifies(self, client, auth_headers):
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))
        resp = client.post(
            "/api/posts",
            json={
                "title": "draft later",
                "slug": "draft-later",
                "content": "c",
                "published": False,
            },
            headers=auth_headers,
        )
        post_id = resp.json()["id"]
        with patch("app.webpush.send_push") as mock_send:
            _update_post(client, auth_headers, post_id, published=True)
        assert mock_send.call_count == 1

    def test_edit_of_published_post_does_not_re_notify(self, client, auth_headers):
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))
        resp = client.post(
            "/api/posts",
            json={"title": "pub", "slug": "pub-post", "content": "c", "published": True},
            headers=auth_headers,
        )
        post_id = resp.json()["id"]
        with patch("app.webpush.send_push") as mock_send:
            _update_post(client, auth_headers, post_id, content="edited")
        assert mock_send.call_count == 0

    def test_dead_endpoint_retired_on_publish(self, client, auth_headers, db_session):
        from app import models
        from pywebpush import WebPushException

        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))

        def _gone(**_):  # noqa: ARG001
            class _R:  # noqa: N801
                status_code = 410

            raise WebPushException("gone", response=_R())

        with patch("app.webpush.send_push", side_effect=_gone):
            _create_post(client, auth_headers, slug="dead-sub")
        assert db_session.query(models.PushSubscription).count() == 0

    def test_fails_closed_when_unconfigured(self, client, auth_headers, monkeypatch):
        client.post("/api/push/subscribe", json=_subscribe_body(want_new_posts=True))
        monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
        monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
        with patch("app.webpush.send_push") as mock_send:
            _create_post(client, auth_headers, slug="unconfigured")
        assert mock_send.call_count == 0
