"""Server-backed reading-history API contract tests (DEC-116, TASK-170).

A signed-in reader's view history is persisted server-side one row per
(reader, post) with a ``viewed_at`` stamp — idempotent upsert on record, a
newest-first publicly-visible list, pagination, isolation between readers, and
a clear-history action. Mirrors the bookmark contract (auth scoping, no
draft-oracle, hidden-post read-path invariant).
"""

HISTORY = "/api/reader/me/history"


def _register(client, email="historian@example.com", password="readerpass123"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


def _token(client, email="historian@example.com"):
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
    return create_post(
        db_session,
        PostCreate(
            **{
                "title": "Readable post",
                "slug": f"history-{_slug_counter}",
                "content": "# Hello\n\nWorld",
                "published": False if draft else published,
                **overrides,
            }
        ),
    )


class TestAuthRequired:
    def test_list_requires_reader_token(self, client):
        assert client.get(HISTORY).status_code == 401

    def test_record_requires_reader_token(self, client):
        assert client.post(f"{HISTORY}/1").status_code == 401

    def test_clear_requires_reader_token(self, client):
        assert client.delete(HISTORY).status_code == 401

    def test_admin_token_cannot_access_history(self, client, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        assert client.get(HISTORY, headers=headers).status_code == 401


class TestRecordView:
    def test_record_appears_in_list(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, title="First", slug="first-read")
        resp = client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["post_id"] == post.id
        assert body["already_existed"] is False

        listed = client.get(HISTORY, headers=_auth(token)).json()
        assert listed["total"] == 1
        item = listed["items"][0]
        assert item["id"] == post.id
        assert item["title"] == "First"
        assert item["slug"] == "first-read"
        assert "content" not in item
        assert item["viewed_at"] is not None

    def test_record_is_idempotent_upsert(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        assert client.post(f"{HISTORY}/{post.id}", headers=_auth(token)).json()["already_existed"] is False
        again = client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert again.status_code == 200
        assert again.json()["already_existed"] is True
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 1  # no duplicate

    def test_revisit_moves_post_to_front(self, client, db_session):
        token = _token(client)
        a = _create_post(db_session, slug="hist-front-a")
        b = _create_post(db_session, slug="hist-front-b")
        client.post(f"{HISTORY}/{a.id}", headers=_auth(token))
        client.post(f"{HISTORY}/{b.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["items"][0]["id"] == b.id
        # Re-reading A bumps it to the front.
        client.post(f"{HISTORY}/{a.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["items"][0]["id"] == a.id

    def test_record_draft_rejected(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, slug="draft-read", draft=True)
        assert client.post(f"{HISTORY}/{post.id}", headers=_auth(token)).status_code == 404

    def test_record_unknown_post_rejected(self, client):
        token = _token(client)
        assert client.post(f"{HISTORY}/999999", headers=_auth(token)).status_code == 404

    def test_record_scheduled_future_post_rejected(self, client, db_session):
        from datetime import UTC, datetime, timedelta

        token = _token(client)
        post = _create_post(
            db_session,
            slug="future-read",
            published=True,
            publish_at=(datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        )
        assert client.post(f"{HISTORY}/{post.id}", headers=_auth(token)).status_code == 404


class TestListHistory:
    def test_empty_list(self, client):
        token = _token(client)
        resp = client.get(HISTORY, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["items"] == []
        assert resp.json()["total"] == 0

    def test_newest_first_ordering(self, client, db_session):
        token = _token(client)
        p1 = _create_post(db_session, title="1")
        p2 = _create_post(db_session, title="2")
        p3 = _create_post(db_session, title="3")
        for pid in (p1.id, p2.id, p3.id):
            client.post(f"{HISTORY}/{pid}", headers=_auth(token))
        listed = client.get(HISTORY, headers=_auth(token)).json()
        assert [i["id"] for i in listed["items"]] == [p3.id, p2.id, p1.id]

    def test_pagination(self, client, db_session):
        token = _token(client)
        posts = [_create_post(db_session) for _ in range(3)]
        for p in posts:
            client.post(f"{HISTORY}/{p.id}", headers=_auth(token))

        page1 = client.get(f"{HISTORY}?page=1&limit=2", headers=_auth(token)).json()
        assert page1["total"] == 3
        assert page1["total_pages"] == 2
        assert len(page1["items"]) == 2

        page2 = client.get(f"{HISTORY}?page=2&limit=2", headers=_auth(token)).json()
        assert page2["total"] == 3
        assert len(page2["items"]) == 1

    def test_unpublished_post_disappears_from_list(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        post = _create_post(db_session, slug="goes-dark-read")
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 1
        update_post(db_session, post.id, PostUpdate(published=False))
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 0

    def test_list_isolation_between_readers(self, client, db_session):
        t1 = _token(client, email="iso1@example.com")
        t2 = _token(client, email="iso2@example.com")
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t1))
        assert client.get(HISTORY, headers=_auth(t1)).json()["total"] == 1
        assert client.get(HISTORY, headers=_auth(t2)).json()["total"] == 0


class TestClearHistory:
    def test_clear_empties_and_is_idempotent(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 1

        first = client.delete(HISTORY, headers=_auth(token))
        assert first.status_code == 204
        assert client.get(HISTORY, headers=_auth(token)).json()["total"] == 0

        again = client.delete(HISTORY, headers=_auth(token))
        assert again.status_code == 204  # idempotent no-op

    def test_clear_does_not_affect_other_reader(self, client, db_session):
        t1 = _token(client, email="clr1@example.com")
        t2 = _token(client, email="clr2@example.com")
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t1))
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t2))
        client.delete(HISTORY, headers=_auth(t1))
        assert client.get(HISTORY, headers=_auth(t1)).json()["total"] == 0
        assert client.get(HISTORY, headers=_auth(t2)).json()["total"] == 1
