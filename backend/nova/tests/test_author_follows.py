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


def _register(client, email, password="readerpass123"):
    resp = client.post(REGISTER, json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _pen_named_author(db, username="pen-author") -> User:
    u = User(username=username, password="x", role="editor", display_name=f"Pen {username}")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _publish_post(client, auth_headers, slug, author_id):
    resp = client.post(
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


def _inbox_total(client, token):
    return client.get("/api/reader/me/notifications", headers=_auth(token)).json()["total"]


def _follow(client, token, author_id):
    resp = client.put(f"/api/reader/me/authors/{author_id}/follow", headers=_auth(token))
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


class TestAuthorFollowLifecycle:
    def test_follow_unfollow_and_notify_toggle_round_trip(self, client, db_session):
        author = _pen_named_author(db_session)
        token = _register(client, "fan@example.com")

        followed = _follow(client, token, author.id)
        assert followed["following"] is True
        assert followed["notify"] is True
        assert followed["display_name"] == f"Pen {author.username}"

        listed = client.get(AUTHORS_ME, headers=_auth(token)).json()
        assert listed["total"] == 1
        assert listed["items"][0]["author_id"] == author.id
        assert listed["items"][0]["notify"] is True

        # Notify toggle.
        toggled = client.patch(
            f"/api/reader/me/authors/{author.id}/follow",
            json={"notify": False},
            headers=_auth(token),
        )
        assert toggled.status_code == 200
        assert toggled.json()["notify"] is False

        # Unfollow is idempotent and empties the list.
        gone = client.delete(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(token))
        assert gone.status_code == 204
        assert client.delete(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(token)).status_code == 204
        assert client.get(AUTHORS_ME, headers=_auth(token)).json()["total"] == 0

    def test_only_pen_named_authors_are_followable(self, client, db_session):
        """No-oracle: a username-only admin and an unknown id both 404."""
        from app.auth import User

        u = User(username="ghost", password="x", role="editor", display_name=None)
        db_session.add(u)
        db_session.commit()
        db_session.refresh(u)

        token = _register(client, "probe@example.com")
        # The same 404 whether the user exists without a pen name or not at all.
        for author_id in (u.id, 999_999):
            resp = client.put(f"/api/reader/me/authors/{author_id}/follow", headers=_auth(token))
            assert resp.status_code == 404, resp.text


class TestAuthorFanout:
    def test_author_publish_reaches_writer_followers_inbox(self, client, db_session, auth_headers):
        author = _pen_named_author(db_session, "signed-author")
        fan = _register(client, "fan2@example.com")
        _follow(client, fan, author.id)
        unrelated = _register(client, "unrelated@example.com")

        _publish_post(client, auth_headers, f"by-author-{author.id}", author.id)

        assert _inbox_total(client, fan) == 1
        assert _inbox_total(client, unrelated) == 0

    def test_notify_off_stops_the_fanout(self, client, db_session, auth_headers):
        author = _pen_named_author(db_session, "quiet-author")
        fan = _register(client, "quietfan@example.com")
        _follow(client, fan, author.id)
        client.patch(
            f"/api/reader/me/authors/{author.id}/follow",
            json={"notify": False},
            headers=_auth(fan),
        )

        _publish_post(client, auth_headers, f"quiet-{author.id}", author.id)
        assert _inbox_total(client, fan) == 0

    def test_unfollow_stops_the_fanout(self, client, db_session, auth_headers):
        author = _pen_named_author(db_session, "ex-author")
        fan = _register(client, "exfan@example.com")
        _follow(client, fan, author.id)
        client.delete(f"/api/reader/me/authors/{author.id}/follow", headers=_auth(fan))

        _publish_post(client, auth_headers, f"ex-{author.id}", author.id)
        assert _inbox_total(client, fan) == 0
