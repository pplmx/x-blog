"""Reader cloud-synced post likes contract tests (round 359, DEC-391/TASK-421).

Signed-in readers get a durable, cross-device "posts I liked" surface — the
missing third pillar beside bookmarks (DEC-059) and the reading-history trail
(DEC-116). A reader like persists in reader_post_likes (unique reader+post), a
re-like is idempotent (count bumps exactly once), an unlike removes the row
and decrements the public counter (floored), and the list only ever shows
*publicly visible* posts — liking a draft/scheduled post fails (no draft leak
on a read path), and un-publishing a post hides it from every like list.

Guest like behavior is untouched: POST /api/posts/{id}/like still increments
anonymously (client dedup) — this suite covers only the reader-authenticated
endpoints.
"""

LIKES = "/api/reader/me/likes"


def _register(client, email="liker@example.com", password="readerpass123"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


def _token(client, email="liker@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _create_post(db_session, *, published=True, draft=False, **overrides):
    """Create a post directly via crud (bypasses the admin API for brevity)."""
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    payload = {
        "title": "Likeable post",
        "slug": f"likeable-{_slug_counter}",
        "content": "# Hello\n\nWorld",
        "published": False if draft else published,
        **overrides,
    }
    return create_post(db_session, PostCreate(**payload))


class TestAuthRequired:
    def test_list_requires_reader_token(self, client):
        resp = client.get(LIKES)
        assert resp.status_code == 401

    def test_admin_token_cannot_list_likes(self, client, admin_token):
        resp = client.get(LIKES, headers=_auth(admin_token))
        assert resp.status_code == 401


class TestLikeAndList:
    def test_like_returns_created_and_appears_in_list(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, title="First", slug="first-like-post")
        resp = client.post(f"{LIKES}/{post.id}", headers=_auth(token))
        assert resp.status_code == 201, resp.text
        assert resp.json()["post_id"] == post.id
        assert resp.json()["already_existed"] is False

        listed = client.get(LIKES, headers=_auth(token)).json()
        assert listed["pagination"]["total"] == 1
        assert listed["items"][0]["id"] == post.id
        assert listed["items"][0]["title"] == "First"
        assert listed["items"][0]["slug"] == "first-like-post"

    def test_like_is_idempotent_and_bumps_counter_once(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        # Second like of the same post: no duplicate, no double-count.
        resp = client.post(f"{LIKES}/{post.id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert resp.json()["already_existed"] is True
        assert client.get(LIKES, headers=_auth(token)).json()["pagination"]["total"] == 1
        # Public counter bumped exactly once for the single new like.
        detail = client.get(f"/api/posts/{post.id}").json()
        assert detail["likes"] == 1

    def test_like_draft_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="like-draft", draft=True)
        resp = client.post(f"{LIKES}/{post.id}", headers=_auth(token))
        assert resp.status_code == 404  # draft invisible → no draft-existence oracle

    def test_unknown_post_404(self, client):
        token = _token(client)
        assert client.post(f"{LIKES}/999999", headers=_auth(token)).status_code == 404

    def test_liked_post_hidden_once_unpublished(self, client, db_session):
        """A liked post that later loses visibility must vanish from the list
        (no draft leak on a read path), while the like row is kept."""
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        post = _create_post(db_session, slug="will-hide")
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        assert client.get(LIKES, headers=_auth(token)).json()["pagination"]["total"] == 1

        update_post(db_session, post.id, PostUpdate(published=False))
        assert client.get(LIKES, headers=_auth(token)).json()["pagination"]["total"] == 0


class TestUnlike:
    def test_unlike_removes_row_and_decrements_counter(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        assert client.get(f"/api/posts/{post.id}").json()["likes"] == 1

        resp = client.delete(f"{LIKES}/{post.id}", headers=_auth(token))
        assert resp.status_code == 204, resp.text
        assert client.get(LIKES, headers=_auth(token)).json()["pagination"]["total"] == 0
        assert client.get(f"/api/posts/{post.id}").json()["likes"] == 0

    def test_unlike_idempotent_no_teardown_below_zero(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        # Never liked: deleting is a 204 no-op and must not tear the counter.
        assert client.delete(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 204
        assert client.get(f"/api/posts/{post.id}").json()["likes"] == 0

    def test_like_then_unlike_then_relike(self, client, db_session):
        """A full round-trip: count 1 → 0 → 1, no drift."""
        token = _token(client)
        post = _create_post(db_session)
        client.post(f"{LIKES}/{post.id}", headers=_auth(token))
        client.delete(f"{LIKES}/{post.id}", headers=_auth(token))
        resp = client.post(f"{LIKES}/{post.id}", headers=_auth(token))
        assert resp.status_code == 201
        assert client.get(f"/api/posts/{post.id}").json()["likes"] == 1


class TestPagination:
    def test_liked_posts_paginate_newest_first(self, client, db_session):
        token = _token(client)
        posts = [_create_post(db_session, title=f"Like {i}", slug=f"like-page-{i}") for i in range(3)]
        for p in posts:
            client.post(f"{LIKES}/{p.id}", headers=_auth(token))

        page1 = client.get(f"{LIKES}?limit=2&page=1", headers=_auth(token)).json()
        page2 = client.get(f"{LIKES}?limit=2&page=2", headers=_auth(token)).json()
        assert len(page1["items"]) == 2
        assert len(page2["items"]) == 1
        assert page1["pagination"]["total"] == 3
        # Newest like first (ids descending).
        assert [p["id"] for p in page1["items"]] == [posts[2].id, posts[1].id]
        assert not {p["id"] for p in page1["items"]} & {p["id"] for p in page2["items"]}
