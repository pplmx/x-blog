"""Cloud-synced bookmarks API contract tests (DEC-059, TASK-132).

Bookmarks are the first reader-owned resource: a reader can keep a private,
server-persisted list of posts. The list must only ever contain *publicly
visible* posts — bookmarking a draft/scheduled post must fail (no draft
leak on a read path, same invariant as comments), and un-publishing a post
hides it from every bookmark list. Adds/removes are idempotent for merge-
friendly client sync (a localStorage-first client re-puts on login).
"""

BOOKMARKS = "/api/reader/me/bookmarks"


async def _register(client, email="bookmarker@example.com", password="readerpass123"):
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


async def _token(client, email="bookmarker@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


async def _create_post(db_session, *, published=True, draft=False, **overrides):
    """Create a post directly via crud (bypasses the admin API for brevity).

    ``draft=True`` is shorthand for ``published=False`` (a draft that exists
    but is not yet public).
    """
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    payload = {
        "title": "Bookmarkable post",
        "slug": f"bookmarkable-{_slug_counter}",
        "content": "# Hello\n\nWorld",
        "published": False if draft else published,
        **overrides,
    }
    return await create_post(db_session, PostCreate(**payload))


class TestAuthRequired:
    async def test_list_requires_reader_token(self, client):
        resp = await client.get(BOOKMARKS)
        assert resp.status_code == 401

    async def test_admin_token_cannot_list_bookmarks(self, client, admin_token):
        resp = await client.get(BOOKMARKS, headers=_auth(admin_token))
        assert resp.status_code == 401


class TestAddBookmark:
    async def test_add_returns_created_and_appears_in_list(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session, title="First", slug="first-post")
        resp = await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 201, resp.text
        assert resp.json()["post_id"] == post.id

        listed = (await client.get(BOOKMARKS, headers=_auth(token))).json()
        assert listed["total"] == 1
        assert listed["items"][0]["id"] == post.id
        assert listed["items"][0]["title"] == "First"
        assert listed["items"][0]["slug"] == "first-post"

    async def test_add_is_idempotent(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)
        assert (await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))).status_code == 201
        # Second put of the same post must not duplicate or error.
        resp = await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert (await client.get(BOOKMARKS, headers=_auth(token))).json()["total"] == 1

    async def test_add_draft_rejected(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session, slug="draft-post", draft=True)
        resp = await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 404  # draft invisible → no draft-existence oracle

    async def test_add_unknown_post_rejected(self, client):
        token = await _token(client)
        resp = await client.put(f"{BOOKMARKS}/999999", headers=_auth(token))
        assert resp.status_code == 404

    async def test_add_does_not_leak_draft_to_another_reader(self, client, db_session):
        """One reader's draft-add must be rejected; the post is not public."""
        # register two readers; first cannot add draft either — assert uniform 404
        token = await _token(client, email="bb@example.com")
        post = await _create_post(db_session, slug="draft-two", draft=True)
        assert (await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))).status_code == 404

    async def test_scheduled_future_post_rejected(self, client, db_session):
        from datetime import UTC, datetime, timedelta

        token = await _token(client)
        post = await _create_post(
            db_session,
            slug="future-post",
            published=True,
            publish_at=(datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        )
        resp = await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 404


class TestListBookmarks:
    async def test_empty_list(self, client):
        token = await _token(client)
        resp = await client.get(BOOKMARKS, headers=_auth(token))
        assert resp.status_code == 200
        # Pagination envelope (ISS-142): page/limit/total_pages ride along.
        assert resp.json() == {"items": [], "total": 0, "page": 1, "limit": 100, "total_pages": 0}

    async def test_serializes_post_summary_shape(self, client, db_session):
        token = await _token(client)
        post = await _create_post(
            db_session,
            title="Shape",
            slug="shape-post",
            excerpt="An excerpt",
            cover_image="https://example.com/c.png",
        )
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        item = (await client.get(BOOKMARKS, headers=_auth(token))).json()["items"][0]
        assert item["id"] == post.id
        assert item["slug"] == "shape-post"
        assert item["excerpt"] == "An excerpt"
        assert item["cover_image"] == "https://example.com/c.png"
        assert "content" not in item  # no full body in a bookmark list
        assert set(item) >= {"title", "excerpt", "cover_image", "created_at", "category", "tags"}

    async def test_unpublished_post_disappears_from_list(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = await _token(client)
        post = await _create_post(db_session, slug="goes-dark")
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert (await client.get(BOOKMARKS, headers=_auth(token))).json()["total"] == 1

        # Un-publish (as the author would); bookmark list must hide it.
        await update_post(db_session, post.id, PostUpdate(published=False))
        assert (await client.get(BOOKMARKS, headers=_auth(token))).json()["total"] == 0

    async def test_list_isolation_between_readers(self, client, db_session):
        t1 = await _token(client, email="iso1@example.com")
        t2 = await _token(client, email="iso2@example.com")
        post = await _create_post(db_session, slug="iso-post")
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        assert (await client.get(BOOKMARKS, headers=_auth(t1))).json()["total"] == 1
        assert (await client.get(BOOKMARKS, headers=_auth(t2))).json()["total"] == 0


class TestRemoveBookmark:
    async def test_remove_is_idempotent(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        first = await client.delete(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert first.status_code == 204
        # Second delete of the same post: still 204, no error.
        again = await client.delete(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert again.status_code == 204
        assert (await client.get(BOOKMARKS, headers=_auth(token))).json()["total"] == 0

    async def test_remove_does_not_affect_other_reader(self, client, db_session):
        t1 = await _token(client, email="rm1@example.com")
        t2 = await _token(client, email="rm2@example.com")
        post = await _create_post(db_session, slug="rm-post")
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t2))
        await client.delete(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        assert (await client.get(BOOKMARKS, headers=_auth(t1))).json()["total"] == 0
        assert (await client.get(BOOKMARKS, headers=_auth(t2))).json()["total"] == 1


class TestClearAllBookmarks:
    """DELETE /api/reader/me/bookmarks — "Clear all" must stick to the cloud
    too, not just a localStorage wipe (TASK-233)."""

    async def test_clear_all_removes_every_bookmark(self, client, db_session):
        token = await _token(client)
        p1 = await _create_post(db_session, slug="clear-a")
        p2 = await _create_post(db_session, slug="clear-b")
        await client.put(f"{BOOKMARKS}/{p1.id}", headers=_auth(token))
        await client.put(f"{BOOKMARKS}/{p2.id}", headers=_auth(token))
        assert (await client.get(BOOKMARKS, headers=_auth(token))).json()["total"] == 2

        resp = await client.delete(BOOKMARKS, headers=_auth(token))
        assert resp.status_code == 204
        assert (await client.get(BOOKMARKS, headers=_auth(token))).json()["total"] == 0

    async def test_clear_all_does_not_touch_another_reader(self, client, db_session):
        t1 = await _token(client, email="clr1@example.com")
        t2 = await _token(client, email="clr2@example.com")
        post = await _create_post(db_session, slug="clear-shared")
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t2))
        await client.delete(BOOKMARKS, headers=_auth(t1))
        assert (await client.get(BOOKMARKS, headers=_auth(t1))).json()["total"] == 0
        assert (await client.get(BOOKMARKS, headers=_auth(t2))).json()["total"] == 1

    async def test_clear_all_idempotent_when_empty(self, client):
        token = await _token(client)
        resp = await client.delete(BOOKMARKS, headers=_auth(token))
        assert resp.status_code == 204
        again = await client.delete(BOOKMARKS, headers=_auth(token))
        assert again.status_code == 204

    async def test_clear_all_requires_reader_token(self, client):
        assert (await client.delete(BOOKMARKS)).status_code == 401


class TestNoStoreCacheHeaders:
    async def test_bookmarks_never_cached(self, client):
        """Reader-owned data must stay Cache-Control: no-store (TASK-129 default)."""
        token = await _token(client)
        resp = await client.get(BOOKMARKS, headers=_auth(token))
        assert resp.headers.get("cache-control", "").lower() == "no-store"


class TestDoneQueueState:
    """Round 361, DEC-395: To-read vs Done bookmark queue states.

    A saved post starts To-read; the reader moves it to Done when it's read
    (pruning the /bookmarks queue). The ``done`` flag is a per-bookmark bool,
    filterable on the list, patchable idempotently, and appears in the
    portable export bundle.
    """

    DONE = "/api/reader/me/bookmarks"

    async def test_new_bookmark_defaults_to_read(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session, title="Default")
        (await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))).raise_for_status()
        item = (await client.get(BOOKMARKS, headers=_auth(token))).json()["items"][0]
        assert item["done"] is False

    async def test_mark_done_and_filter(self, client, db_session):
        token = await _token(client)
        p1 = await _create_post(db_session, title="Read me")
        p2 = await _create_post(db_session, title="Read later")
        await client.put(f"{BOOKMARKS}/{p1.id}", headers=_auth(token))
        await client.put(f"{BOOKMARKS}/{p2.id}", headers=_auth(token))

        resp = await client.patch(f"{self.DONE}/{p1.id}/done", json={"done": True}, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json() == {"post_id": p1.id, "done": True}

        done = (await client.get(f"{BOOKMARKS}?done=true", headers=_auth(token))).json()
        assert done["total"] == 1
        assert done["items"][0]["id"] == p1.id
        assert done["items"][0]["done"] is True

        todo = (await client.get(f"{BOOKMARKS}?done=false", headers=_auth(token))).json()
        assert todo["total"] == 1
        assert todo["items"][0]["id"] == p2.id
        assert todo["items"][0]["done"] is False

    async def test_mark_back_to_read(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True}, headers=_auth(token))
        resp = await client.patch(f"{self.DONE}/{post.id}/done", json={"done": False}, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["done"] is False
        todo = (await client.get(f"{BOOKMARKS}?done=false", headers=_auth(token))).json()
        assert [i["id"] for i in todo["items"]] == [post.id]

    async def test_mark_done_is_idempotent(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True}, headers=_auth(token))
        again = await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True}, headers=_auth(token))
        assert again.status_code == 200
        assert again.json()["done"] is True

    async def test_mark_done_unbookmarked_404(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)  # never saved
        resp = await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True}, headers=_auth(token))
        assert resp.status_code == 404

    async def test_mark_done_requires_reader_token(self, client, db_session):
        post = await _create_post(db_session)
        assert (await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True})).status_code == 401

    async def test_mark_done_admin_token_rejected(self, client, admin_token, db_session):
        post = await _create_post(db_session)
        resp = await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True}, headers=_auth(admin_token))
        assert resp.status_code == 401

    async def test_done_filter_caps_on_visibility(self, client, db_session):
        """Done flag never resurrects a post that went non-public (TASK-129 invariant)."""
        token = await _token(client)
        post = await _create_post(db_session, title="Vanishing")
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True}, headers=_auth(token))
        # Unpublish the post: it must vanish from the Done filter too.
        from app.crud import update_post
        from app.schemas import PostUpdate

        await update_post(db_session, post.id, PostUpdate(published=False))

        done = (await client.get(f"{BOOKMARKS}?done=true", headers=_auth(token))).json()
        assert done["total"] == 0
        assert done["items"] == []

    async def test_done_in_export_bundle(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session, title="Export me")
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        await client.patch(f"{self.DONE}/{post.id}/done", json={"done": True}, headers=_auth(token))
        bundle = (await client.get("/api/reader/me/export", headers=_auth(token))).json()
        done = [b for b in bundle["bookmarks"] if b["post_id"] == post.id]
        assert done and done[0]["done"] is True
