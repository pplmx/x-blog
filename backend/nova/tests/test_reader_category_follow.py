"""Reader category-follow contract tests (DEC-140, TASK-182).

A signed-in reader can follow a category as a durable, cross-device intent
(distinct from the per-device new-post category pin, DEC-076) and be pushed
a notification when a new public post is published in it. Covers auth scoping,
follow/unfollow/list semantics, reader isolation, per-follow notify control,
and the dispatch integration (category followers are fanned out and deduped
against the per-device new-post push).
"""

import base64
from unittest.mock import patch

ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/AAAAAAAAAAAAAAAAAAAA"

FOLLOWS = "/api/reader/me/category-follows"
_n = 0


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _subscribe_body(endpoint: str = ENDPOINT, prefix: int = 4, **extra) -> dict:
    point = b"\x04" + bytes([prefix] * 32) + bytes([prefix + 1] * 32)
    keys = {"p256dh": _b64url(point), "auth": _b64url(bytes([prefix]) * 16)}
    return {"endpoint": endpoint, "keys": keys, **extra}


async def _register(client, email="cat@example.com", password="readerpass123"):
    return await client.post("/api/reader/register", json={"email": email, "password": password})


async def _token(client, email="cat@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_category(client, auth_headers, name="AI"):
    global _n
    _n += 1
    resp = await client.post("/api/categories", json={"name": f"{name}-{_n}"}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_category_post(client, auth_headers, category_id, slug):
    global _n
    _n += 1
    resp = await client.post(
        "/api/posts",
        json={
            "title": f"Cat {slug}",
            "slug": f"{slug}-{_n}",
            "content": "content",
            "published": True,
            "category_id": category_id,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestAuthRequired:
    async def test_list_requires_token(self, client):
        assert (await client.get(FOLLOWS)).status_code == 401

    async def test_follow_requires_token(self, client):
        assert (await client.put("/api/reader/me/categories/1/follow")).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        assert (await client.get(FOLLOWS, headers={"Authorization": f"Bearer {admin_token}"})).status_code == 401


class TestFollow:
    async def test_follow_idempotent_and_listed(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        first = await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))
        assert first.status_code == 201, first.text
        again = await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))
        assert again.status_code == 200
        assert again.json()["notify"] is True

        listed = (await client.get(FOLLOWS, headers=_auth(token))).json()
        assert listed["total"] == 1
        assert listed["items"][0]["name"] == category["name"]
        assert listed["items"][0]["notify"] is True

    async def test_follow_unknown_category_404(self, client):
        token = await _token(client)
        assert (await client.put("/api/reader/me/categories/999999/follow", headers=_auth(token))).status_code == 404

    async def test_unfollow_idempotent(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))
        url = f"/api/reader/me/categories/{category['id']}/follow"
        assert (await client.delete(url, headers=_auth(token))).status_code == 204
        # second delete is a 204 no-op
        assert (await client.delete(url, headers=_auth(token))).status_code == 204
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["total"] == 0

    async def test_isolated_between_readers(self, client, auth_headers):
        t1 = await _token(client, email="c1@example.com")
        t2 = await _token(client, email="c2@example.com")
        category = await _create_category(client, auth_headers)
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(t1))
        assert (await client.get(FOLLOWS, headers=_auth(t1))).json()["total"] == 1
        assert (await client.get(FOLLOWS, headers=_auth(t2))).json()["total"] == 0


class TestNotifyControl:
    async def _token_and_category(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))
        return token, category

    async def test_toggle_notify_off_then_on(self, client, auth_headers):
        token, category = await self._token_and_category(client, auth_headers)
        url = f"/api/reader/me/categories/{category['id']}/follow"

        off = await client.patch(url, json={"notify": False}, headers=_auth(token))
        assert off.status_code == 200, off.text
        assert off.json()["notify"] is False
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["items"][0]["notify"] is False

        on = await client.patch(url, json={"notify": True}, headers=_auth(token))
        assert on.status_code == 200
        assert on.json()["notify"] is True

    async def test_toggle_requires_following_404(self, client, auth_headers):
        token = await _token(client)
        category = await _create_category(client, auth_headers)
        resp = await client.patch(
            f"/api/reader/me/categories/{category['id']}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        assert resp.status_code == 404

    async def test_patch_requires_token(self, client):
        assert (await client.patch("/api/reader/me/categories/1/follow", json={"notify": False})).status_code == 401


class TestCategoryDispatch:
    async def _reader_with_subbed_push(self, client, want_new_posts=False):
        token = await _token(client)
        headers = _auth(token)
        headers["Content-Type"] = "application/json"
        resp = await client.post(
            "/api/push/subscribe",
            json=_subscribe_body(endpoint=ENDPOINT, want_new_posts=want_new_posts),
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        return token

    async def test_new_category_post_notifies_follower(self, client, auth_headers):
        token = await self._reader_with_subbed_push(client)
        category = await _create_category(client, auth_headers)
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            await _create_category_post(client, auth_headers, category["id"], "cat-part")

        assert mock_send.call_count == 1
        assert mock_send.call_args.kwargs["payload"]["url"].startswith("/posts/cat-part-")

    async def test_silent_follower_receives_nothing(self, client, auth_headers):
        token = await self._reader_with_subbed_push(client)
        category = await _create_category(client, auth_headers)
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))
        await client.patch(
            f"/api/reader/me/categories/{category['id']}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        # Still tracked, just not notified.
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["total"] == 1

        with patch("app.webpush.send_push") as mock_send:
            await _create_category_post(client, auth_headers, category["id"], "silent-cat")
        assert mock_send.call_count == 0

    async def test_non_follower_receives_nothing(self, client, auth_headers):
        await self._reader_with_subbed_push(client)
        category = await _create_category(client, auth_headers)
        # reader registered + subscribed but does NOT follow the category.
        with patch("app.webpush.send_push") as mock_send:
            await _create_category_post(client, auth_headers, category["id"], "unfollowed-cat")
        assert mock_send.call_count == 0

    async def test_dedupes_with_all_new_posts_subscriber(self, client, auth_headers):
        # A reader opted into all new posts AND follows the category gets one push.
        token = await self._reader_with_subbed_push(client, want_new_posts=True)
        category = await _create_category(client, auth_headers)
        await client.put(f"/api/reader/me/categories/{category['id']}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            await _create_category_post(client, auth_headers, category["id"], "dedupe-cat")
        assert mock_send.call_count == 1
