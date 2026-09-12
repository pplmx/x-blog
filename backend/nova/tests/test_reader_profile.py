"""Public reader profile endpoint tests (DEC-294, TASK-376).

A reader's display name on a comment is a verified identity; the profile page
turns it into a linkable public homepage: GET /api/readers/{id} returns the
reader's display_name, join date and their approved comments on
publicly-visible posts. Covers 404 for unknown ids, no-email (PII), only
approved comments, only public posts (drafts/scheduled excluded), pagination,
and the idempotent profile shape even with zero comments.
"""

from app.auth import ReaderAccount
from app.crud import approve_comment

PROFILE = "/api/readers/{rid}"
_n = 0


def _register(client, email="profile@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="profile@example.com"):
    return _register(client, email=email).json()["access_token"]


def _create_post(client, auth_headers, slug, published=True):
    global _n
    _n += 1
    body = {"title": f"Profile Post {slug}", "slug": f"{slug}-{_n}", "content": "content", "published": published}
    resp = client.post("/api/posts", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _approved_comment(client, db_session, post_id, token, content):
    c = client.post(
        f"/api/comments/post/{post_id}",
        json={"nickname": "anonymous-placeholder", "email": "reader@example.com", "content": content},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert c.status_code == 201, c.text
    cid = c.json()["id"]
    approve_comment(db_session, cid, approved=True)
    return c.json()


def _reader_db(db_session, reader_id):
    return db_session.get(ReaderAccount, reader_id)


class TestReaderProfile:
    def test_unknown_reader_404(self, client):
        assert client.get(PROFILE.format(rid=999_999)).status_code == 404

    def test_profile_has_no_email(self, client, auth_headers, db_session):
        _register(client)
        reader = db_session.query(ReaderAccount).filter_by(email="profile@example.com").first()
        resp = client.get(PROFILE.format(rid=reader.id))
        assert resp.status_code == 200
        body = resp.json()["profile"]
        assert body["display_name"] is None or isinstance(body["display_name"], str)
        assert "email" not in body
        assert "last_login_at" not in body

    def test_lists_approved_comments_on_public_posts(self, client, auth_headers, db_session):
        token = _token(client, email="c1@example.com")
        reader = db_session.query(ReaderAccount).filter_by(email="c1@example.com").first()
        post = _create_post(client, auth_headers, "pub")
        _approved_comment(client, db_session, post["id"], token, "hello from reader")
        _approved_comment(client, db_session, post["id"], token, "second comment")

        resp = client.get(PROFILE.format(rid=reader.id))
        assert resp.status_code == 200
        body = resp.json()
        assert body["profile"]["id"] == reader.id
        assert body["pagination"]["total"] == 2
        contents = [i["content"] for i in body["items"]]
        assert "second comment" in contents and "hello from reader" in contents
        # Serialized as CommentPublic (no email / no ip_address on public rows).
        assert "email" not in body["items"][0]
        assert "ip_address" not in body["items"][0]

    def test_excludes_unapproved_comments(self, client, auth_headers, db_session):
        token = _token(client, email="c2@example.com")
        reader = db_session.query(ReaderAccount).filter_by(email="c2@example.com").first()
        post = _create_post(client, auth_headers, "mod")
        _approved_comment(client, db_session, post["id"], token, "ok")
        # A pending comment must not appear.
        pending = client.post(
            f"/api/comments/post/{post['id']}",
            json={"nickname": "n", "email": "e@example.com", "content": "pending one"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert pending.status_code == 201
        # (not approved)

        body = client.get(PROFILE.format(rid=reader.id)).json()
        assert body["pagination"]["total"] == 1
        assert [i["content"] for i in body["items"]] == ["ok"]

    def test_excludes_comments_on_drafts(self, client, auth_headers, db_session):
        _register(client, email="c3@example.com")
        reader = db_session.query(ReaderAccount).filter_by(email="c3@example.com").first()
        draft = _create_post(client, auth_headers, "draft", published=False)
        # Comments on a draft are rejected at create (post not publicly visible) —
        # write directly to the DB to prove the profile gate also drops drafts.
        from app import schemas
        from app.crud import create_comment

        created = create_comment(
            db_session,
            draft["id"],
            schemas.CommentCreate(nickname="n", email="e@example.com", content="on draft", parent_id=None),
            "127.0.0.1",
            reader=_reader_db(db_session, reader.id),
        )
        approve_comment(db_session, created.id, approved=True)
        db_session.flush()

        body = client.get(PROFILE.format(rid=reader.id)).json()
        assert body["pagination"]["total"] == 0

    def test_pagination_window(self, client, auth_headers, db_session):
        token = _token(client, email="c4@example.com")
        reader = db_session.query(ReaderAccount).filter_by(email="c4@example.com").first()
        post = _create_post(client, auth_headers, "many")
        for i in range(5):
            _approved_comment(client, db_session, post["id"], token, f"comment {i}")

        body = client.get(PROFILE.format(rid=reader.id), params={"limit": 2}).json()
        assert len(body["items"]) == 2
        assert body["pagination"] == {"total": 5, "page": 1, "limit": 2, "total_pages": 3}
        # page 2 must be disjoint from page 1
        page2 = client.get(PROFILE.format(rid=reader.id), params={"limit": 2, "page": 2}).json()
        ids1 = {i["id"] for i in body["items"]}
        ids2 = {i["id"] for i in page2["items"]}
        assert ids1.isdisjoint(ids2)

    def test_empty_profile_is_a_valid_200(self, client, auth_headers, db_session):
        _token(client, email="empty@example.com")
        reader = db_session.query(ReaderAccount).filter_by(email="empty@example.com").first()
        resp = client.get(PROFILE.format(rid=reader.id))
        assert resp.status_code == 200
        body = resp.json()
        assert body["profile"]["id"] == reader.id
        assert body["items"] == []
        assert body["pagination"]["total"] == 0
