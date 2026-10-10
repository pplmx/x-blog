"""Author follows (round 353).

On a multi-editor blog a reader who loved one writer's posts subscribes to
JUST that person — topic-shaped category/series/tag follows can't express it.
This covers the follow lifecycle (idempotent PUT, list, notify toggle, DELETE),
the no-oracle gate (only a pen-named author is followable — a username-only
admin or unknown id both 404), and the new-post fan-out: a writer-following
reader gets an inbox row when that author publishes, respects notify=off, and
stops when the follow is dropped.
"""

from app.auth import User

REGISTER = "/api/reader/register"
AUTHORS_ME = "/api/reader/me/author-follows"
POSTS = "/api/posts"


async def _register(client, email, password="readerpass123"):
    resp = await client.post(REGISTER, json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _pen_named_author(db, username="pen-author") -> User:
    u = User(username=username, password="x", role="editor", display_name=f"Pen {username}")
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _publish_post(client, auth_headers, slug, author_id):
    resp = await client.post(
        POSTS,
        json={
            "title": slug,
            "slug": slug,
            "content": "c",
            "published": True,
            "author_id": author_id,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _inbox_total(client, token):
    return (await client.get("/api/reader/me/notifications", headers=_auth(token))).json()["total"]


async def _follow(client, token, author_id):
    resp = await client.put(f"/api/reader/me/authors/{author_id}/follow", headers=_auth(token))
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


class TestAuthorFollowLifecycle:
    async def test_follow_unfollow_and_notify_toggle_round_trip(self, client, db_session):
        author = await _pen_named_author(db_session)
        token = await _register(client, "fan@example.com")

        followed = await _follow(client, token, author.id)
        assert followed["following"] is True
        assert followed["notify"] is True
        assert followed["display_name"] == f"Pen {author.username}"

        listed = (await client.get(AUTHORS_ME, headers=_auth(token))).json()
        assert listed["total"] == 1
        assert listed["items"][0]["author_id"] == author.id
        assert listed["items"][0]["notify"] is True

        # Notify toggle.
        toggled = await client.patch(
            f"/api/reader/me/authors/{author.id}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        assert toggled.status_code == 200
        assert toggled.json()["notify"] is False

        # Unfollow is idempotent and empties the list.
        gone = await client.delete(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(token))
        assert gone.status_code == 204
        assert (
            await client.delete(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(token))
        ).status_code == 204
        assert (await client.get(AUTHORS_ME, headers=_auth(token))).json()["total"] == 0

    async def test_only_pen_named_authors_are_followable(self, client, db_session):
        """No-oracle: a username-only admin and an unknown id both 404."""
        from app.auth import User

        u = User(username="ghost", password="x", role="editor", display_name=None)
        db_session.add(u)
        await db_session.commit()
        await db_session.refresh(u)

        token = await _register(client, "probe@example.com")
        # The same 404 whether the user exists without a pen name or not at all.
        for author_id in (u.id, 999_999):
            resp = await client.put(f"/api/reader/me/authors/{author_id}/follow", headers=_auth(token))
            assert resp.status_code == 404, resp.text


class TestAuthorFanout:
    async def test_author_publish_reaches_writer_followers_inbox(self, client, db_session, auth_headers):
        author = await _pen_named_author(db_session, "signed-author")
        fan = await _register(client, "fan2@example.com")
        await _follow(client, fan, author.id)
        unrelated = await _register(client, "unrelated@example.com")

        await _publish_post(client, auth_headers, f"by-author-{author.id}", author.id)

        assert await _inbox_total(client, fan) == 1
        assert await _inbox_total(client, unrelated) == 0

    async def test_notify_off_stops_the_fanout(self, client, db_session, auth_headers):
        author = await _pen_named_author(db_session, "quiet-author")
        fan = await _register(client, "quietfan@example.com")
        await _follow(client, fan, author.id)
        await client.patch(
            f"/api/reader/me/authors/{author.id}/follow",
            json={"notify": False},
            headers=_auth(fan),
        )

        await _publish_post(client, auth_headers, f"quiet-{author.id}", author.id)
        assert await _inbox_total(client, fan) == 0

    async def test_unfollow_stops_the_fanout(self, client, db_session, auth_headers):
        author = await _pen_named_author(db_session, "ex-author")
        fan = await _register(client, "exfan@example.com")
        await _follow(client, fan, author.id)
        await client.delete(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(fan))

        await _publish_post(client, auth_headers, f"ex-{author.id}", author.id)
        assert await _inbox_total(client, fan) == 0
