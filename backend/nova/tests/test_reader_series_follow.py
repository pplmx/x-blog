"""Reader series-follow ('new part' push) contract tests (DEC-132, TASK-178;
per-follow notification control DEC-138, TASK-181).

A signed-in reader can follow a series and be pushed a notification when a new
public post is published in it. Covers auth scoping, follow/unfollow/list
semantics, reader isolation, and the dispatch integration (series followers are
fanned out and deduped against the standard new-post push). TASK-181 adds a
per-follow ``notify`` toggle that decouples tracking from push: a follow with
notify=false is still listed but is not fanned out on new-part dispatch.
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


async def _register(client, email="series@example.com", password="readerpass123"):
    return await client.post("/api/reader/register", json={"email": email, "password": password})


async def _token(client, email="series@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_series(client, auth_headers, slug="tutorial"):
    global _slug_counter
    _slug_counter += 1
    resp = await client.post(
        "/api/series",
        json={"title": f"Series {slug}", "slug": f"{slug}-{_slug_counter}", "description": "d"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_series_post(client, auth_headers, series_id, order, slug):
    global _slug_counter
    _slug_counter += 1
    resp = await client.post(
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
    async def test_list_follows_requires_token(self, client):
        assert (await client.get(FOLLOWS)).status_code == 401

    async def test_follow_requires_token(self, client):
        assert (await client.put("/api/reader/me/series/1/follow")).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        resp = await client.get(FOLLOWS, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 401


class TestFollow:
    async def test_follow_idempotent_and_listed(self, client, auth_headers):
        token = await _token(client)
        series = await _create_series(client, auth_headers)
        first = await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        assert first.status_code == 201, first.text
        again = await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        assert again.status_code == 200
        assert again.json()["notify"] is True

        listed = (await client.get(FOLLOWS, headers=_auth(token))).json()
        assert listed["total"] == 1
        assert listed["items"][0]["slug"] == series["slug"]
        assert listed["items"][0]["notify"] is True

    async def test_follow_unknown_series_404(self, client):
        token = await _token(client)
        assert (await client.put("/api/reader/me/series/999999/follow", headers=_auth(token))).status_code == 404

    async def test_unfollow_idempotent(self, client, auth_headers):
        token = await _token(client)
        series = await _create_series(client, auth_headers)
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        assert (
            await client.delete(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        ).status_code == 204
        # second delete is a 204 no-op
        assert (
            await client.delete(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        ).status_code == 204
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["total"] == 0

    async def test_isolated_between_readers(self, client, auth_headers):
        t1 = await _token(client, email="f1@example.com")
        t2 = await _token(client, email="f2@example.com")
        series = await _create_series(client, auth_headers)
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(t1))
        assert (await client.get(FOLLOWS, headers=_auth(t1))).json()["total"] == 1
        assert (await client.get(FOLLOWS, headers=_auth(t2))).json()["total"] == 0


class TestNotifyControl:
    async def _token_and_series(self, client, auth_headers):
        token = await _token(client)
        series = await _create_series(client, auth_headers)
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        return token, series

    async def test_toggle_notify_off_then_on(self, client, auth_headers):
        token, series = await self._token_and_series(client, auth_headers)
        url = f"/api/reader/me/series/{series['id']}/follow"

        off = await client.patch(url, json={"notify": False}, headers=_auth(token))
        assert off.status_code == 200, off.text
        assert off.json()["notify"] is False

        listed = (await client.get(FOLLOWS, headers=_auth(token))).json()
        assert listed["items"][0]["notify"] is False

        on = await client.patch(url, json={"notify": True}, headers=_auth(token))
        assert on.status_code == 200
        assert on.json()["notify"] is True

    async def test_toggle_requires_following_404(self, client, auth_headers):
        token = await _token(client)
        series = await _create_series(client, auth_headers)
        resp = await client.patch(
            f"/api/reader/me/series/{series['id']}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        assert resp.status_code == 404

    async def test_patch_requires_token(self, client):
        assert (await client.patch("/api/reader/me/series/1/follow", json={"notify": False})).status_code == 401

    async def test_patch_unknown_series_404(self, client, auth_headers):
        token = await _token(client)
        assert (
            await client.patch("/api/reader/me/series/999999/follow", json={"notify": False}, headers=_auth(token))
        ).status_code == 404


class TestSeriesPartDispatch:
    async def _reader_with_subbed_push(self, client, endpoint=ENDPOINT, want_new_posts=False):
        token = await _token(client)
        headers = _auth(token)
        headers["Content-Type"] = "application/json"
        resp = await client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint=endpoint, want_new_posts=want_new_posts),
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        return token

    async def test_new_series_part_notifies_follower(self, client, auth_headers):
        token = await self._reader_with_subbed_push(client)
        series = await _create_series(client, auth_headers)
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            await _create_series_post(client, auth_headers, series["id"], 0, "part-one")

        assert mock_send.call_count == 1
        assert mock_send.call_args.kwargs["payload"]["url"].startswith("/posts/part-one-")

    async def test_non_follower_receives_nothing(self, client, auth_headers):
        await self._reader_with_subbed_push(client)
        series = await _create_series(client, auth_headers)
        # reader registered + subscribed but does NOT follow the series.

        with patch("app.webpush.send_push") as mock_send:
            await _create_series_post(client, auth_headers, series["id"], 0, "part-only")
        assert mock_send.call_count == 0

    async def test_silent_follower_receives_nothing(self, client, auth_headers):
        # A follower who turned notifications off is still tracked (listed) but
        # is NOT fanned out on new-part dispatch.
        token = await self._reader_with_subbed_push(client)
        series = await _create_series(client, auth_headers)
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))
        await client.patch(
            f"/api/reader/me/series/{series['id']}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        # Still listed (tracked), just not notified.
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["total"] == 1

        with patch("app.webpush.send_push") as mock_send:
            await _create_series_post(client, auth_headers, series["id"], 0, "part-silent")
        assert mock_send.call_count == 0

    async def test_dedupes_with_all_new_posts_subscriber(self, client, auth_headers):
        # A reader who opted into all new posts AND follows the series gets a
        # single notification (union by endpoint).
        token = await self._reader_with_subbed_push(client, want_new_posts=True)
        series = await _create_series(client, auth_headers)
        await client.put(f"/api/reader/me/series/{series['id']}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            await _create_series_post(client, auth_headers, series["id"], 0, "part-dedupe")

        assert mock_send.call_count == 1
