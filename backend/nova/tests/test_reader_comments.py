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
- /api/reader/me/comments lists only the caller's own approved comments
  (pending excluded — same read-path visibility rule), isolated per reader.
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
        assert reader["id"] == 1
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
        assert resp.json()["reader"]["id"] == 1
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

    def test_pending_comments_hidden(self, client, db_session):
        post = _create_post(db_session)
        token = _token(client)
        _post_comment(client, post.id, headers=_auth(token))  # left pending
        resp = client.get("/api/reader/me/comments", headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

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
