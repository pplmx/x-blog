"""Reader-attributed comments contract tests (DEC-062, TASK-135).

Reader accounts give commenters a verified identity: a signed-in reader's
comment is stamped with their account (client-supplied nickname/email is
ignored — a reader cannot spoof another reader's display name), and the reader
can list their own comment history. Anonymous comments still work unchanged
with free-text nickname/email.

Critical properties:
- a signed-in reader's comment serializes their account identity (display_name,
  not the nickname they typed, and email never echoed publicly);
- identity always comes from the JWT, never from client input;
- /api/reader/me/comments lists the caller's own comments across statuses
  (pending / approved / rejected) with a per-item `status`, isolated per reader;
- a reader can DELETE their own comment (any status); others' comments 404.
"""

from datetime import datetime


def _create_post(db_session, slug="reader-comment-post"):
    from app.crud import create_post
    from app.schemas import PostCreate

    return create_post(
        db_session,
        PostCreate(title="Reader comment post", slug=slug, content="# Hello", published=True),
    )


def _register(client, email="commenter@example.com", display_name="Reading Reader"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": display_name},
    )


def _token(client, **kw):
    return _register(client, **kw).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _post_comment(client, post_id, body=None, headers=None, **headers_kw):
    payload = body or {"nickname": "x", "email": "x@x.com", "content": "hello"}
    return client.post(f"/api/comments/post/{post_id}", json=payload, headers=headers or headers_kw)


class TestSignedInIdentity:
    def test_signed_in_comment_uses_account_display_name(self, client, db_session):
        post = _create_post(db_session)
        token = _token(client, display_name="Riki")
        # Client sends a forged nickname/email — must be ignored for readers.
        resp = _post_comment(
            client,
            post.id,
            {"nickname": "Not Riki", "email": "forged@example.com", "content": "Nice post!"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["nickname"] == "Riki"
        reader = data.get("reader")
        assert reader is not None
        # Dialect-safe account id check: SQLite (re)uses id 1 after a rollback
        # but PostgreSQL advances sequences even when the insert rolls back, so
        # an absolute id assertion only holds for the first registration. The
        # identity contract is the stamped display_name, not the id number.
        assert isinstance(reader["id"], int) and reader["id"] > 0
        assert reader["display_name"] == "Riki"
        # The account email is PII and must never ride a public comment —
        # neither the forged client email nor the stored account email.
        assert "forged@example.com" not in resp.text
        assert "commenter@example.com" not in resp.text
        assert "email" not in reader

    def test_identity_comes_from_jwt_not_client(self, client, db_session):
        """A spoofed display_name is ignored; identity is the account's."""
        post = _create_post(db_session)
        token = _token(client, email="clara@example.com", display_name="Clara")
        resp = _post_comment(
            client,
            post.id,
            {"nickname": "Clara", "email": "impostor@example.com", "content": "hi"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["reader"]["display_name"] == "Clara"
        # See test_signed_in_comment_uses_account_display_name: no absolute id
        # assertion — PG sequences advance on rolled-back inserts (SQLite reuses
        # ids), so a later registration in the process has a nonzero id > 1.
        assert isinstance(resp.json()["reader"]["id"], int) and resp.json()["reader"]["id"] > 0
        assert "impostor@example.com" not in resp.text

    def test_anonymous_comment_unaffected(self, client, db_session):
        post = _create_post(db_session)
        resp = _post_comment(client, post.id, {"nickname": "Guest", "email": "g@example.com", "content": "hi"})
        assert resp.status_code == 201, resp.text
        assert resp.json()["nickname"] == "Guest"
        assert resp.json().get("reader") is None


class TestCommentHistory:
    def test_list_own_approved_comment(self, client, db_session):
        from app.crud import approve_comment

        post = _create_post(db_session)
        token = _token(client)
        created = _post_comment(client, post.id, headers=_auth(token)).json()
        approve_comment(db_session, created["id"], approved=True)

        resp = client.get("/api/reader/me/comments", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == created["id"]
        assert body["items"][0]["post_id"] == post.id
        assert body["items"][0]["status"] == "approved"

    def test_pending_comments_shown_as_pending(self, client, db_session):
        """A pending comment is the author's own content — show it with a
        pending status (moderated-blog visibility: the author knows it is in
        review). (DEC-066 flips the DEC-062 approved-only read path)."""
        post = _create_post(db_session)
        token = _token(client)
        created = _post_comment(client, post.id, headers=_auth(token)).json()
        resp = client.get("/api/reader/me/comments", headers=_auth(token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == created["id"]
        assert body["items"][0]["status"] == "pending"

    def test_rejected_comment_shows_rejected_status(self, client, db_session):
        from app.crud import approve_comment

        post = _create_post(db_session)
        token = _token(client)
        created = _post_comment(client, post.id, headers=_auth(token)).json()
        approve_comment(db_session, created["id"], approved=False)

        body = client.get("/api/reader/me/comments", headers=_auth(token)).json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == created["id"]
        assert body["items"][0]["status"] == "rejected"

    def test_isolated_per_reader(self, client, db_session):
        from app.crud import approve_comment

        post = _create_post(db_session)
        t1 = _token(client, email="a1@example.com", display_name="A")
        t2 = _token(client, email="a2@example.com", display_name="B")
        own = _post_comment(client, post.id, headers=_auth(t1)).json()
        approve_comment(db_session, own["id"], approved=True)
        assert client.get("/api/reader/me/comments", headers=_auth(t1)).json()["total"] == 1
        assert client.get("/api/reader/me/comments", headers=_auth(t2)).json()["total"] == 0

    def test_requires_reader_token(self, client):
        resp = client.get("/api/reader/me/comments")
        assert resp.status_code == 401

    def test_comment_shape_has_identity_fields(self, client, db_session):
        """The history item exposes the same reader-attributed shape as the post
        comment list, plus post context for navigation from the page."""
        import re

        from app.crud import approve_comment

        post = _create_post(db_session)
        token = _token(client, display_name="Riki")
        created = _post_comment(client, post.id, headers=_auth(token)).json()
        approve_comment(db_session, created["id"], approved=True)

        resp = client.get("/api/reader/me/comments", headers=_auth(token))
        item = resp.json()["items"][0]
        assert item["content"] == created["content"]
        assert item["reader"]["display_name"] == "Riki"
        assert isinstance(item["post"], dict)
        assert re.match(r"^\d{4}-\d{2}-\d{2}T", item["created_at"])
        assert datetime.fromisoformat(item["created_at"].replace("Z", "+00:00")) is not None


class TestDeleteOwnComment:
    def _own_comment(self, client, db_session, approved=None):
        from app.crud import approve_comment

        post = _create_post(db_session, slug=f"del-post-{id(self)}")
        token = _token(client, email=f"del-{id(self)}@example.com", display_name="Del")
        created = _post_comment(client, post.id, headers=_auth(token)).json()
        if approved is not None:
            approve_comment(db_session, created["id"], approved=approved)
        return post, created["id"], token

    def test_delete_own_pending_comment(self, client, db_session):
        post, comment_id, token = self._own_comment(client, db_session)  # left pending
        resp = client.delete(f"/api/reader/me/comments/{comment_id}", headers=_auth(token))
        assert resp.status_code == 204, resp.text
        assert client.get("/api/reader/me/comments", headers=_auth(token)).json()["total"] == 0

    def test_delete_own_approved_comment(self, client, db_session):
        post, comment_id, token = self._own_comment(client, db_session, approved=True)
        resp = client.delete(f"/api/reader/me/comments/{comment_id}", headers=_auth(token))
        assert resp.status_code == 204, resp.text
        assert client.get("/api/reader/me/comments", headers=_auth(token)).json()["total"] == 0

    def test_cannot_delete_another_readers_comment(self, client, db_session):
        _post, comment_id, _token_a = self._own_comment(client, db_session)
        other = _token(client, email=f"other-{id(self)}@example.com", display_name="Other")
        resp = client.delete(f"/api/reader/me/comments/{comment_id}", headers=_auth(other))
        assert resp.status_code == 404, resp.text

    def test_delete_requires_reader_token(self, client, db_session):
        post, comment_id, _token_a = self._own_comment(client, db_session)
        resp = client.delete(f"/api/reader/me/comments/{comment_id}")
        assert resp.status_code == 401


class TestEditOwnComment:
    def _own_approved(self, client, db_session):
        from app.crud import approve_comment

        post = _create_post(db_session, slug=f"edit-post-{id(self)}")
        token = _token(client, email=f"edit-{id(self)}@example.com", display_name="Editor")
        created = _post_comment(client, post.id, headers=_auth(token)).json()
        approve_comment(db_session, created["id"], approved=True)
        return post, created["id"], token

    def test_edit_own_approved_comment(self, client, db_session):
        post, comment_id, token = self._own_approved(client, db_session)
        resp = client.patch(
            f"/api/reader/me/comments/{comment_id}",
            json={"content": "edited body"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["content"] == "edited body"
        assert data["edited_at"] is not None
        # The public thread reflects the edit.
        listed = client.get(f"/api/comments/post/{post.id}").json()["items"]
        assert [c["content"] for c in listed if c["id"] == comment_id] == ["edited body"]

    def test_cannot_edit_another_readers_comment(self, client, db_session):
        _post, comment_id, token = self._own_approved(client, db_session)
        other = _token(client, email=f"edit-other-{id(self)}@example.com", display_name="Other")
        resp = client.patch(
            f"/api/reader/me/comments/{comment_id}",
            json={"content": "sneaky"},
            headers=_auth(other),
        )
        assert resp.status_code == 404, resp.text

    def test_edit_requires_reader_token(self, client, db_session):
        _post, comment_id, _token_a = self._own_approved(client, db_session)
        resp = client.patch(f"/api/reader/me/comments/{comment_id}", json={"content": "anon"})
        assert resp.status_code == 401

    def test_edit_unknown_comment_404(self, client, db_session):
        token = _token(client, email=f"edit-none-{id(self)}@example.com")
        resp = client.patch(
            "/api/reader/me/comments/999999",
            json={"content": "x"},
            headers=_auth(token),
        )
        assert resp.status_code == 404


class TestDeleteReparentsReplies:
    def test_delete_own_comment_promotes_its_replies_to_top_level(self, client, db_session):
        from app.crud import approve_comment

        post = _create_post(db_session, slug=f"del-reply-{id(self)}")
        token = _token(client, email=f"del-r-{id(self)}@example.com", display_name="Del")
        top = _post_comment(client, post.id, headers=_auth(token)).json()
        approve_comment(db_session, top["id"], approved=True)
        reply = _post_comment(
            client,
            post.id,
            {"nickname": "x", "email": "x@x.com", "content": "a reply", "parent_id": top["id"]},
        ).json()
        approve_comment(db_session, reply["id"], approved=True)

        resp = client.delete(f"/api/reader/me/comments/{top['id']}", headers=_auth(token))
        assert resp.status_code == 204, resp.text

        # The reply survives, now a top-level comment (not orphaned).
        items = client.get(f"/api/comments/post/{post.id}").json()["items"]
        moved = next((c for c in items if c["id"] == reply["id"]), None)
        assert moved is not None
        assert moved["parent_id"] is None
        # The deleted comment is gone.
        assert all(c["id"] != top["id"] for c in items)


class TestAutoApproveVerifiedReaders:
    """Moderation trust tier (DEC-098, TASK-161): AUTO_APPROVE_READER_COMMENTS."""

    def test_verified_reader_comment_publishes_immediately_when_enabled(self, client, db_session, monkeypatch):
        from app.routers import comments as comments_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        post = _create_post(db_session, slug=f"auto-on-{id(self)}")
        token = _token(client, email=f"auto-on-{id(self)}@example.com", display_name="Auto")
        created = _post_comment(client, post.id, headers=_auth(token)).json()

        assert created["is_approved"] is True, "verified reader comment should auto-approve"
        # It is on the public list immediately, with no moderator approve call.
        listed = client.get(f"/api/comments/post/{post.id}").json()["items"]
        assert any(c["id"] == created["id"] for c in listed)

    def test_anonymous_comment_stays_pending_when_enabled(self, client, db_session, monkeypatch):
        from app.routers import comments as comments_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        post = _create_post(db_session, slug=f"auto-anon-{id(self)}")
        created = _post_comment(client, post.id).json()  # no reader token -> anonymous

        assert created["is_approved"] is False, "anonymous comment must stay moderated"

    def test_verified_reader_comment_stays_pending_when_disabled(self, client, db_session, monkeypatch):
        from app.routers import comments as comments_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", False)
        post = _create_post(db_session, slug=f"auto-off-{id(self)}")
        token = _token(client, email=f"auto-off-{id(self)}@example.com", display_name="Waiter")
        created = _post_comment(client, post.id, headers=_auth(token)).json()

        assert created["is_approved"] is False, "flag-off must preserve pending moderation"
        # Not on the public list until the moderator approves.
        listed = client.get(f"/api/comments/post/{post.id}").json()["items"]
        assert not any(c["id"] == created["id"] for c in listed)


class TestFilterAndPaginate:
    """My Comments status filter + pagination (DEC-102, TASK-163)."""

    def _reader_with_statuses(self, client, db_session, count=3):
        from app.crud import approve_comment

        post = _create_post(db_session, slug=f"filter-{id(self)}")
        token = _token(client, email=f"filter-{id(self)}@example.com", display_name="Filterer")
        headers = _auth(token)
        ids = {}
        for i in range(count):
            c = _post_comment(
                client,
                post.id,
                {"nickname": "x", "email": "x@x.com", "content": f"comment {i}"},
                headers=headers,
            ).json()
            ids[c["id"]] = c["id"]
            if i == 1:
                approve_comment(db_session, c["id"], approved=True)
            elif i == 2:
                approve_comment(db_session, c["id"], approved=False)
            # i == 0 stays pending
        return token, list(ids.values())

    def test_filter_approved(self, client, db_session):
        token, ids = self._reader_with_statuses(client, db_session)
        data = client.get("/api/reader/me/comments", params={"status": "approved"}, headers=_auth(token)).json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == ids[1]
        assert data["items"][0]["status"] == "approved"

    def test_filter_rejected(self, client, db_session):
        token, ids = self._reader_with_statuses(client, db_session)
        data = client.get("/api/reader/me/comments", params={"status": "rejected"}, headers=_auth(token)).json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == ids[2]
        assert data["items"][0]["status"] == "rejected"

    def test_filter_pending(self, client, db_session):
        token, ids = self._reader_with_statuses(client, db_session)
        data = client.get("/api/reader/me/comments", params={"status": "pending"}, headers=_auth(token)).json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == ids[0]
        assert data["items"][0]["status"] == "pending"

    def test_filter_all(self, client, db_session):
        token, _ids = self._reader_with_statuses(client, db_session)
        data = client.get("/api/reader/me/comments", headers=_auth(token)).json()
        assert data["total"] == 3

    def test_invalid_status_422(self, client, db_session):
        token, _ids = self._reader_with_statuses(client, db_session)
        resp = client.get("/api/reader/me/comments", params={"status": "banana"}, headers=_auth(token))
        assert resp.status_code == 422

    def test_pagination(self, client, db_session):
        token, _ids = self._reader_with_statuses(client, db_session, count=3)
        page1 = client.get(
            "/api/reader/me/comments",
            params={"page": 1, "limit": 2},
            headers=_auth(token),
        ).json()
        assert len(page1["items"]) == 2
        assert page1["total"] == 3
        assert page1["total_pages"] == 2

        page2 = client.get(
            "/api/reader/me/comments",
            params={"page": 2, "limit": 2},
            headers=_auth(token),
        ).json()
        assert len(page2["items"]) == 1
