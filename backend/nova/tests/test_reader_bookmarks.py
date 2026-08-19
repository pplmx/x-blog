"""Cloud-synced bookmarks API contract tests (DEC-059, TASK-132).

Bookmarks are the first reader-owned resource: a reader can keep a private,
server-persisted list of posts. The list must only ever contain *publicly
visible* posts — bookmarking a draft/scheduled post must fail (no draft
leak on a read path, same invariant as comments), and un-publishing a post
hides it from every bookmark list. Adds/removes are idempotent for merge-
friendly client sync (a localStorage-first client re-puts on login).
"""

BOOKMARKS = "/api/reader/me/bookmarks"


def _register(client, email="bookmarker@example.com", password="readerpass123"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


def _token(client, email="bookmarker@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _create_post(db_session, *, published=True, draft=False, **overrides):
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
    return create_post(db_session, PostCreate(**payload))


class TestAuthRequired:
    def test_list_requires_reader_token(self, client):
        resp = client.get(BOOKMARKS)
        assert resp.status_code == 401

    def test_admin_token_cannot_list_bookmarks(self, client, admin_token):
        resp = client.get(BOOKMARKS, headers=_auth(admin_token))
        assert resp.status_code == 401


class TestAddBookmark:
    def test_add_returns_created_and_appears_in_list(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, title="First", slug="first-post")
        resp = client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 201, resp.text
        assert resp.json()["post_id"] == post.id

        listed = client.get(BOOKMARKS, headers=_auth(token)).json()
        assert listed["total"] == 1
        assert listed["items"][0]["id"] == post.id
        assert listed["items"][0]["title"] == "First"
        assert listed["items"][0]["slug"] == "first-post"

    def test_add_is_idempotent(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        assert client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token)).status_code == 201
        # Second put of the same post must not duplicate or error.
        resp = client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert client.get(BOOKMARKS, headers=_auth(token)).json()["total"] == 1

    def test_add_draft_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="draft-post", draft=True)
        resp = client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 404  # draft invisible → no draft-existence oracle

    def test_add_unknown_post_rejected(self, client):
        token = _token(client)
        resp = client.put(f"{BOOKMARKS}/999999", headers=_auth(token))
        assert resp.status_code == 404

    def test_add_does_not_leak_draft_to_another_reader(self, client, db_session):
        """One reader's draft-add must be rejected; the post is not public."""
        # register two readers; first cannot add draft either — assert uniform 404
        token = _token(client, email="bb@example.com")
        post = _create_post(db_session, slug="draft-two", draft=True)
        assert client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token)).status_code == 404

    def test_scheduled_future_post_rejected(self, client, db_session):
        from datetime import UTC, datetime, timedelta

        token = _token(client)
        post = _create_post(
            db_session,
            slug="future-post",
            published=True,
            publish_at=(datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        )
        resp = client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert resp.status_code == 404


class TestListBookmarks:
    def test_empty_list(self, client):
        token = _token(client)
        resp = client.get(BOOKMARKS, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json() == {"items": [], "total": 0}

    def test_serializes_post_summary_shape(self, client, db_session):
        token = _token(client)
        post = _create_post(
            db_session,
            title="Shape",
            slug="shape-post",
            excerpt="An excerpt",
            cover_image="https://example.com/c.png",
        )
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        item = client.get(BOOKMARKS, headers=_auth(token)).json()["items"][0]
        assert item["id"] == post.id
        assert item["slug"] == "shape-post"
        assert item["excerpt"] == "An excerpt"
        assert item["cover_image"] == "https://example.com/c.png"
        assert "content" not in item  # no full body in a bookmark list
        assert set(item) >= {"title", "excerpt", "cover_image", "created_at", "category", "tags"}

    def test_unpublished_post_disappears_from_list(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        post = _create_post(db_session, slug="goes-dark")
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert client.get(BOOKMARKS, headers=_auth(token)).json()["total"] == 1

        # Un-publish (as the author would); bookmark list must hide it.
        update_post(db_session, post.id, PostUpdate(published=False))
        assert client.get(BOOKMARKS, headers=_auth(token)).json()["total"] == 0

    def test_list_isolation_between_readers(self, client, db_session):
        t1 = _token(client, email="iso1@example.com")
        t2 = _token(client, email="iso2@example.com")
        post = _create_post(db_session, slug="iso-post")
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        assert client.get(BOOKMARKS, headers=_auth(t1)).json()["total"] == 1
        assert client.get(BOOKMARKS, headers=_auth(t2)).json()["total"] == 0


class TestRemoveBookmark:
    def test_remove_is_idempotent(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        first = client.delete(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert first.status_code == 204
        # Second delete of the same post: still 204, no error.
        again = client.delete(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        assert again.status_code == 204
        assert client.get(BOOKMARKS, headers=_auth(token)).json()["total"] == 0

    def test_remove_does_not_affect_other_reader(self, client, db_session):
        t1 = _token(client, email="rm1@example.com")
        t2 = _token(client, email="rm2@example.com")
        post = _create_post(db_session, slug="rm-post")
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t2))
        client.delete(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        assert client.get(BOOKMARKS, headers=_auth(t1)).json()["total"] == 0
        assert client.get(BOOKMARKS, headers=_auth(t2)).json()["total"] == 1


class TestNoStoreCacheHeaders:
    def test_bookmarks_never_cached(self, client):
        """Reader-owned data must stay Cache-Control: no-store (TASK-129 default)."""
        token = _token(client)
        resp = client.get(BOOKMARKS, headers=_auth(token))
        assert resp.headers.get("cache-control", "").lower() == "no-store"
