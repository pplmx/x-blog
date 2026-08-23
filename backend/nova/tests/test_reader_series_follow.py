"""Reader series-follow ('new part' push) contract tests (DEC-132, TASK-178).

A signed-in reader can follow a series and be pushed a notification when a new
public post is published in it. Covers auth scoping, follow/unfollow/list
semantics, reader isolation, and the dispatch integration (series followers are
fanned out and deduped against the standard new-post push).
"""

import base64
from unittest.mock import patch

ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/AAAAAAAAAAAAAAAAAAAA"
OTHER = "https://fcm.googleapis.com/fcm/send/BBBBBBBBBBBBBBBBBBBBBBBB"

FOLLOWS = "/api/reader/me/series-follows"
_slug_counter = 0


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _subscribe_body(endpoint: str = ENDPOINT, prefix: int = 4, **extra) -> dict:
    point = b"\x04" + bytes([prefix] * 32) + bytes([prefix + 1] * 32)
    keys = {"p256dh": _b64url(point), "auth": _b64url(bytes([prefix]) * 16)}
    return {"endpoint": endpoint, "keys": keys, **extra}


def _register(client, email="series@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="series@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_series(client, auth_headers, slug="tutorial"):
    global _slug_counter
    _slug_counter += 1
    resp = client.post(
        "/api/series",
        json={"title": f"Series {slug}", "slug": f"{slug}-{_slug_counter}", "description": "d"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_series_post(client, auth_headers, series_id, order, slug):
    global _slug_counter
    _slug_counter += 1
    resp = client.post(
        "/api/posts",
        json={
            "title": f"Part {slug}",
            "slug": f"{slug}-{_slug_counter}",
            "content": "content",
            "published": True,
            "series_id": series_id,
            "series_order": order,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestAuthRequired:
    def test_list_follows_requires_token(self, client):
        assert client.get(FOLLOWS).status_code == 401

    def test_follow_requires_token(self, client):
        assert client.put("/api/reader/me/series/1/follow").status_code == 401

    def test_admin_token_rejected(self, client, admin_token):
        resp = client.get(FOLLOWS, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 401


class TestFollow:
    def test_follow_idempotent_and_listed(self, client, auth_headers):
        token = _token(client)
        series = _create_series(client, auth_headers)
        first = client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        assert first.status_code == 201, first.text
        again = client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        assert again.status_code == 200

        listed = client.get(FOLLOWS, headers=_auth(token)).json()
        assert listed["total"] == 1
        assert listed["items"][0]["slug"] == series["slug"]

    def test_follow_unknown_series_404(self, client):
        token = _token(client)
        assert client.put("/api/reader/me/series/999999/follow", headers=_auth(token)).status_code == 404

    def test_unfollow_idempotent(self, client, auth_headers):
        token = _token(client)
        series = _create_series(client, auth_headers)
        client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        assert client.delete(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token)).status_code == 204
        # second delete is a 204 no-op
        assert client.delete(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token)).status_code == 204
        assert client.get(FOLLOWS, headers=_auth(token)).json()["total"] == 0

    def test_isolated_between_readers(self, client, auth_headers):
        t1 = _token(client, email="f1@example.com")
        t2 = _token(client, email="f2@example.com")
        series = _create_series(client, auth_headers)
        client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(t1))
        assert client.get(FOLLOWS, headers=_auth(t1)).json()["total"] == 1
        assert client.get(FOLLOWS, headers=_auth(t2)).json()["total"] == 0


class TestSeriesPartDispatch:
    def _reader_with_subbed_push(self, client, endpoint=ENDPOINT, want_new_posts=False):
        token = _token(client)
        headers = _auth(token)
        headers["Content-Type"] = "application/json"
        resp = client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint=endpoint, want_new_posts=want_new_posts),
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        return token

    def test_new_series_part_notifies_follower(self, client, auth_headers):
        token = self._reader_with_subbed_push(client)
        series = _create_series(client, auth_headers)
        client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            _create_series_post(client, auth_headers, series["id"], 0, "part-one")

        assert mock_send.call_count == 1
        assert mock_send.call_args.kwargs["payload"]["url"].startswith("/posts/part-one-")

    def test_non_follower_receives_nothing(self, client, auth_headers):
        self._reader_with_subbed_push(client)
        series = _create_series(client, auth_headers)
        # reader registered + subscribed but does NOT follow the series.

        with patch("app.webpush.send_push") as mock_send:
            _create_series_post(client, auth_headers, series["id"], 0, "part-only")
        assert mock_send.call_count == 0

    def test_dedupes_with_all_new_posts_subscriber(self, client, auth_headers):
        # A reader who opted into all new posts AND follows the series gets a
        # single notification (union by endpoint).
        token = self._reader_with_subbed_push(client, want_new_posts=True)
        series = _create_series(client, auth_headers)
        client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            _create_series_post(client, auth_headers, series["id"], 0, "part-dedupe")

        assert mock_send.call_count == 1
