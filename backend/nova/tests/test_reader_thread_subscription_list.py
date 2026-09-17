"""Reader subscribed-discussions management tests (DEC-419, TASK-435).

Thread subscriptions (DEC-078) were the only followable thing without a
reader-scoped management surface: a reader could follow a post's comment
thread on the post page but had no way to list what they follow or prune it.
These endpoints close that — GET /api/reader/me/thread-subscriptions lists the
publicly-visible followed posts, and DELETE /api/reader/me/thread-subscriptions/
{post_id} unsubscribes idempotently (same invariant as every follow list: a
followed post that becomes a draft stops appearing, the row is kept).
"""

LIST = "/api/reader/me/thread-subscriptions"


def _create_post(db_session, slug="sub-list-post", published=True):
    from app.crud import create_post
    from app.schemas import PostCreate

    return create_post(
        db_session,
        PostCreate(title="Sub list post", slug=slug, content="# Hi", published=published),
    )


def _register(client, email="sublist@example.com"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123"},
    )


def _token(client, **kw):
    return _register(client, **kw).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _subscribe(client, token, post_id):
    resp = client.put(f"/api/posts/{post_id}/subscription", headers=_auth(token))
    assert resp.status_code in (200, 201)


class TestAuth:
    def test_list_requires_reader_token(self, client):
        assert client.get(LIST).status_code == 401

    def test_delete_requires_reader_token(self, client):
        assert client.delete(f"{LIST}/1").status_code == 401


class TestList:
    def test_empty_when_nothing_subscribed(self, client, db_session):
        token = _token(client)
        data = client.get(LIST, headers=_auth(token)).json()
        assert data["pagination"]["total"] == 0
        assert data["items"] == []

    def test_lists_subscribed_posts_newest_subscription_first(self, client, db_session):
        token = _token(client)
        p1 = _create_post(db_session, slug="sub-list-a")
        p2 = _create_post(db_session, slug="sub-list-b")
        _subscribe(client, token, p1.id)
        _subscribe(client, token, p2.id)

        data = client.get(LIST, headers=_auth(token)).json()
        assert data["pagination"]["total"] == 2
        titles = [i["title"] for i in data["items"]]
        assert titles == ["Sub list post", "Sub list post"]
        assert {i["slug"] for i in data["items"]} == {"sub-list-a", "sub-list-b"}
        # Newest follow first (p2 subscribed after p1).
        assert data["items"][0]["slug"] == "sub-list-b"

    def test_pagination_and_totals(self, client, db_session):
        token = _token(client)
        for i in range(3):
            _subscribe(client, token, _create_post(db_session, slug=f"sub-list-p{i}").id)

        data = client.get(LIST, headers=_auth(token), params={"page": 2, "limit": 2}).json()
        assert data["pagination"]["total"] == 3
        assert len(data["items"]) == 1
        assert data["pagination"]["page"] == 2
        assert data["pagination"]["total_pages"] == 2

    def test_followed_post_that_turned_draft_hides_but_is_kept(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        live = _create_post(db_session, slug="sub-list-live")
        vanishing = _create_post(db_session, slug="sub-list-vanish")
        _subscribe(client, token, live.id)
        _subscribe(client, token, vanishing.id)
        update_post(db_session, vanishing.id, PostUpdate(published=False))

        data = client.get(LIST, headers=_auth(token)).json()
        assert data["pagination"]["total"] == 1
        assert data["items"][0]["slug"] == "sub-list-live"

    def test_scoped_to_caller(self, client, db_session):
        token_a = _token(client, email="sublist-a@example.com")
        token_b = _token(client, email="sublist-b@example.com")
        p = _create_post(db_session)
        _subscribe(client, token_a, p.id)

        assert client.get(LIST, headers=_auth(token_a)).json()["pagination"]["total"] == 1
        assert client.get(LIST, headers=_auth(token_b)).json()["pagination"]["total"] == 0


class TestUnsubscribe:
    def test_delete_removes_and_is_idempotent(self, client, db_session):
        token = _token(client)
        p = _create_post(db_session)
        _subscribe(client, token, p.id)
        assert client.get(LIST, headers=_auth(token)).json()["pagination"]["total"] == 1

        assert client.delete(f"{LIST}/{p.id}", headers=_auth(token)).status_code == 204
        assert client.get(LIST, headers=_auth(token)).json()["pagination"]["total"] == 0
        # Idempotent: deleting a non-followed (or unknown) post is still 204.
        assert client.delete(f"{LIST}/{p.id}", headers=_auth(token)).status_code == 204
        assert client.delete(f"{LIST}/999999", headers=_auth(token)).status_code == 204

    def test_unsubscribe_is_scoped_to_caller(self, client, db_session):
        token_a = _token(client, email="sublist-x@example.com")
        token_b = _token(client, email="sublist-y@example.com")
        p = _create_post(db_session)
        _subscribe(client, token_a, p.id)
        _subscribe(client, token_b, p.id)

        # A's unsubscribe must not drop B's follow.
        assert client.delete(f"{LIST}/{p.id}", headers=_auth(token_a)).status_code == 204
        assert client.get(LIST, headers=_auth(token_b)).json()["pagination"]["total"] == 1
