"""Reader my-comments keyword search tests (DEC-411, TASK-431).

A signed-in reader can filter their own comment history on /me/comments by a
term (case-insensitive) matching the comment content, so a reader with a long
history can recall a specific comment. The filter composes with the status
filter and stays scoped to the caller's own comments; LIKE metacharacters are
escaped so % and _ match literally (round-366 precedent).
"""


def _post(db_session, slug="search-comment-post"):
    from app.crud import create_post
    from app.schemas import PostCreate

    return create_post(
        db_session,
        PostCreate(title="Search comment post", slug=slug, content="# Hello", published=True),
    )


def _register(client, email="search@example.com", display_name="Search Reader"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": display_name},
    )


def _token(client, **kw):
    return _register(client, **kw).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _post_comment(client, post_id, content, token):
    return client.post(
        f"/api/comments/post/{post_id}",
        # Signed-in readers' submitted nickname/email are ignored (identity from
        # the JWT); placeholders just satisfy CommentCreate's min_length=1.
        json={"nickname": "x", "email": "x@x.com", "content": content},
        headers=_auth(token),
    )


class TestCommentsSearch:
    def test_q_filters_comment_content(self, client, db_session):
        token = _token(client)
        post = _post(db_session)
        assert _post_comment(client, post.id, "Rust borrow checker tips", token).status_code == 201
        assert _post_comment(client, post.id, "a cake recipe for the weekend", token).status_code == 201

        data = client.get("/api/reader/me/comments", headers=_auth(token), params={"q": "borrow"}).json()
        assert data["total"] == 1
        assert data["items"][0]["content"] == "Rust borrow checker tips"

    def test_q_is_case_insensitive(self, client, db_session):
        token = _token(client)
        post = _post(db_session)
        assert _post_comment(client, post.id, "Hello World", token).status_code == 201

        data = client.get("/api/reader/me/comments", headers=_auth(token), params={"q": "HELLO"}).json()
        assert data["total"] == 1

    def test_blank_q_is_ignored(self, client, db_session):
        token = _token(client)
        post = _post(db_session)
        assert _post_comment(client, post.id, "first comment", token).status_code == 201
        assert _post_comment(client, post.id, "second comment", token).status_code == 201

        data = client.get("/api/reader/me/comments", headers=_auth(token), params={"q": "   "}).json()
        assert data["total"] == 2

    def test_q_escapes_literal_percent_and_underscore(self, client, db_session):
        """Round-366 precedent: % and _ must match literally, not as wildcards."""
        token = _token(client)
        post = _post(db_session)
        assert _post_comment(client, post.id, "sold at 100% off", token).status_code == 201
        assert _post_comment(client, post.id, "use snake_case names", token).status_code == 201

        pct = client.get("/api/reader/me/comments", headers=_auth(token), params={"q": "100%"}).json()
        assert pct["total"] == 1
        assert pct["items"][0]["content"] == "sold at 100% off"

        us = client.get("/api/reader/me/comments", headers=_auth(token), params={"q": "_"}).json()
        assert us["total"] == 1
        assert us["items"][0]["content"] == "use snake_case names"

    def test_q_composes_with_status_filter(self, client, db_session):
        from app.crud import approve_comment

        token = _token(client)
        post = _post(db_session)
        approved = _post_comment(client, post.id, "batteries included", token).json()
        _post_comment(client, post.id, "battery not included", token)
        assert approve_comment(db_session, approved["id"]) is not None

        data = client.get(
            "/api/reader/me/comments", headers=_auth(token), params={"q": "batter", "status": "approved"}
        ).json()
        assert data["total"] == 1
        assert data["items"][0]["content"] == "batteries included"

    def test_q_scoped_to_own_comments(self, client, db_session):
        token_a = _token(client, email="alice@example.com")
        token_b = _token(client, email="bob@example.com", display_name="Bob Reader")
        post = _post(db_session)
        assert _post_comment(client, post.id, "shared keyword here", token_a).status_code == 201
        assert _post_comment(client, post.id, "shared keyword here too", token_b).status_code == 201

        data = client.get("/api/reader/me/comments", headers=_auth(token_a), params={"q": "shared"}).json()
        assert data["total"] == 1
        assert data["items"][0]["reader"]["display_name"] == "Search Reader"

    def test_q_total_and_pagination_reflect_filter(self, client, db_session):
        token = _token(client)
        post = _post(db_session)
        for i in range(3):
            assert _post_comment(client, post.id, f"needle {i}", token).status_code == 201
        assert _post_comment(client, post.id, "other topic", token).status_code == 201

        data = client.get(
            "/api/reader/me/comments", headers=_auth(token), params={"q": "needle", "page": 2, "limit": 2}
        ).json()
        assert data["total"] == 3
        assert len(data["items"]) == 1
        assert data["page"] == 2
        assert data["total_pages"] == 2

    def test_filters_pending_comments_under_q(self, client, db_session):
        """A q search must still see the reader's own pending comments (the
        whole point of the my-comments page), not just approved ones."""
        token = _token(client)
        post = _post(db_session)
        assert _post_comment(client, post.id, "awaiting moderation", token).status_code == 201

        data = client.get("/api/reader/me/comments", headers=_auth(token), params={"q": "awaiting"}).json()
        assert data["total"] == 1
        assert data["items"][0]["status"] == "pending"

    def test_overlong_q_is_422(self, client, db_session):
        token = _token(client)
        resp = client.get("/api/reader/me/comments", headers=_auth(token), params={"q": "x" * 201})
        assert resp.status_code == 422
