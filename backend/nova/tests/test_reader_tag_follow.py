"""Reader tag-follow contract tests (DEC-195, TASK-215).

Tags are the fine-grained subscription axis categories are too coarse for: a
signed-in reader can follow a tag (durable, cross-device) and be pushed a
notification when a new public post carries it. Mirrors the category-follow
contract (DEC-140/TASK-182) — auth scoping, follow/unfollow/list semantics,
reader isolation, per-follow notify control, and the dispatch integration
(tag followers fanned out + deduped against the per-device push).
"""

import base64
from unittest.mock import patch

ENDPOINT = "https://updates.push.services.mozilla.com/wpush/v2/BBBBBBBBBBBBBBBBBBBB"

FOLLOWS = "/api/reader/me/tag-follows"
_n = 0


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _subscribe_body(endpoint: str = ENDPOINT, prefix: int = 5, **extra) -> dict:
    point = b"\x04" + bytes([prefix] * 32) + bytes([prefix + 1] * 32)
    keys = {"p256dh": _b64url(point), "auth": _b64url(bytes([prefix]) * 16)}
    return {"endpoint": endpoint, "keys": keys, **extra}


async def _register(client, email="tag@example.com", password="readerpass123"):
    return await client.post("/api/reader/register", json={"email": email, "password": password})


async def _token(client, email="tag@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_tagged_post(client, auth_headers, slug, tag_names):
    global _n
    _n += 1
    resp = await client.post(
        "/api/posts",
        json={
            "title": f"Tag {slug}",
            "slug": f"{slug}-{_n}",
            "content": "content",
            "published": True,
            "tags": tag_names,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _tag_id(client, name):
    tags = (await client.get("/api/tags")).json()
    for tag in tags:
        if tag["name"] == name:
            return tag["id"]
    raise AssertionError(f"tag {name!r} not found in /api/tags")


class TestAuthRequired:
    async def test_list_requires_token(self, client):
        assert (await client.get(FOLLOWS)).status_code == 401

    async def test_follow_requires_token(self, client):
        assert (await client.put("/api/reader/me/tags/1/follow")).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        assert (await client.get(FOLLOWS, headers={"Authorization": f"Bearer {admin_token}"})).status_code == 401


class TestFollow:
    async def test_follow_idempotent_and_listed(self, client, auth_headers):
        token = await _token(client)
        await _create_tagged_post(client, auth_headers, "alpha", ["rust"])
        tag_id = await _tag_id(client, "rust")

        first = await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))
        assert first.status_code == 201, first.text
        assert first.json()["tag_name"] == "rust"
        assert first.json()["following"] is True

        again = await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))
        assert again.status_code == 200
        assert again.json()["notify"] is True

        listed = (await client.get(FOLLOWS, headers=_auth(token))).json()
        assert listed["total"] == 1
        assert listed["items"][0]["name"] == "rust"
        assert listed["items"][0]["notify"] is True

    async def test_follow_unknown_tag_404(self, client):
        token = await _token(client)
        assert (await client.put("/api/reader/me/tags/999999/follow", headers=_auth(token))).status_code == 404

    async def test_unfollow_idempotent(self, client, auth_headers):
        token = await _token(client)
        await _create_tagged_post(client, auth_headers, "beta", ["postgres"])
        tag_id = await _tag_id(client, "postgres")
        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))

        url = f"/api/reader/me/tags/{tag_id}/follow"
        assert (await client.delete(url, headers=_auth(token))).status_code == 204
        # second delete is a 204 no-op
        assert (await client.delete(url, headers=_auth(token))).status_code == 204
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["total"] == 0

    async def test_isolated_between_readers(self, client, auth_headers):
        t1 = await _token(client, email="t1@example.com")
        t2 = await _token(client, email="t2@example.com")
        await _create_tagged_post(client, auth_headers, "gamma", ["kubernetes"])
        tag_id = await _tag_id(client, "kubernetes")

        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(t1))
        assert (await client.get(FOLLOWS, headers=_auth(t1))).json()["total"] == 1
        assert (await client.get(FOLLOWS, headers=_auth(t2))).json()["total"] == 0


class TestNotifyControl:
    async def _token_and_tag(self, client, auth_headers):
        token = await _token(client)
        await _create_tagged_post(client, auth_headers, "delta", ["fsharp"])
        tag_id = await _tag_id(client, "fsharp")
        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))
        return token, tag_id

    async def test_toggle_notify_off_then_on(self, client, auth_headers):
        token, tag_id = await self._token_and_tag(client, auth_headers)
        url = f"/api/reader/me/tags/{tag_id}/follow"

        off = await client.patch(url, json={"notify": False}, headers=_auth(token))
        assert off.status_code == 200, off.text
        assert off.json()["notify"] is False
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["items"][0]["notify"] is False

        on = await client.patch(url, json={"notify": True}, headers=_auth(token))
        assert on.status_code == 200
        assert on.json()["notify"] is True

    async def test_toggle_requires_following_404(self, client, auth_headers):
        token = await _token(client)
        await _create_tagged_post(client, auth_headers, "epsilon", ["elixir"])
        tag_id = await _tag_id(client, "elixir")
        resp = await client.patch(
            f"/api/reader/me/tags/{tag_id}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        assert resp.status_code == 404

    async def test_patch_requires_token(self, client):
        assert (await client.patch("/api/reader/me/tags/1/follow", json={"notify": False})).status_code == 401


class TestTagDispatch:
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

    async def test_new_tagged_post_notifies_follower(self, client, auth_headers):
        token = await self._reader_with_subbed_push(client)
        await _create_tagged_post(client, auth_headers, "zeta", ["zig"])
        tag_id = await _tag_id(client, "zig")
        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            await _create_tagged_post(client, auth_headers, "zeta2", ["zig"])

        assert mock_send.call_count == 1
        assert mock_send.call_args.kwargs["payload"]["url"].startswith("/posts/zeta2-")

    async def test_silent_follower_receives_nothing(self, client, auth_headers):
        token = await self._reader_with_subbed_push(client)
        await _create_tagged_post(client, auth_headers, "eta", ["sqlite"])
        tag_id = await _tag_id(client, "sqlite")
        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))
        await client.patch(
            f"/api/reader/me/tags/{tag_id}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        # Still tracked, just not notified.
        assert (await client.get(FOLLOWS, headers=_auth(token))).json()["total"] == 1

        with patch("app.webpush.send_push") as mock_send:
            await _create_tagged_post(client, auth_headers, "eta2", ["sqlite"])
        assert mock_send.call_count == 0

    async def test_non_follower_receives_nothing(self, client, auth_headers):
        await self._reader_with_subbed_push(client)
        await _create_tagged_post(client, auth_headers, "theta", ["haskell"])
        await _create_tagged_post(client, auth_headers, "theta2", ["haskell"])
        # reader registered + subscribed but does NOT follow the tag.
        with patch("app.webpush.send_push") as mock_send:
            await _create_tagged_post(client, auth_headers, "theta3", ["haskell"])
        assert mock_send.call_count == 0

    async def test_dedupes_with_all_new_posts_subscriber(self, client, auth_headers):
        # A reader opted into all new posts AND follows the tag gets one push.
        token = await self._reader_with_subbed_push(client, want_new_posts=True)
        await _create_tagged_post(client, auth_headers, "iota", ["nginx"])
        tag_id = await _tag_id(client, "nginx")
        await client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            await _create_tagged_post(client, auth_headers, "iota2", ["nginx"])
        assert mock_send.call_count == 1

    async def test_dedupes_across_two_followed_tags(self, client, auth_headers):
        # A reader following two tags carried by the same post gets one push.
        token = await self._reader_with_subbed_push(client)
        await _create_tagged_post(client, auth_headers, "kappa", ["redis"])
        await _create_tagged_post(client, auth_headers, "kappa2", ["docker"])
        redis_id = await _tag_id(client, "redis")
        docker_id = await _tag_id(client, "docker")
        await client.put(f"/api/reader/me/tags/{redis_id}/follow", headers=_auth(token))
        await client.put(f"/api/reader/me/tags/{docker_id}/follow", headers=_auth(token))

        with patch("app.webpush.send_push") as mock_send:
            await _create_tagged_post(client, auth_headers, "kappa3", ["redis", "docker"])
        assert mock_send.call_count == 1
