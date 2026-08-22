"""Reader data-export contract tests (DEC-126, TASK-175).

GET /api/reader/me/export returns a portable JSON bundle scoped to the caller:
account profile, public-visible bookmarks (with folder), the reader's own
comments (any moderation status), and their public-visible reading history.
Nothing cross-reader, and no draft/scheduled-post leakage on bookmarks/history.
"""

EXPORT = "/api/reader/me/export"
BOOKMARKS = "/api/reader/me/bookmarks"
HISTORY = "/api/reader/me/history"
FOLDERS = f"{BOOKMARKS}/folders"


def _register(client, email="exporter@example.com", password="readerpass123", display_name=None):
    payload = {"email": email, "password": password}
    if display_name:
        payload["display_name"] = display_name
    return client.post("/api/reader/register", json=payload)


def _token(client, email="exporter@example.com", display_name=None):
    return _register(client, email=email, display_name=display_name).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _create_post(db_session, *, published=True, draft=False, **overrides):
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return create_post(
        db_session,
        PostCreate(
            **{
                "title": "Exportable post",
                "slug": f"export-{_slug_counter}",
                "content": "# Hello\n\nWorld",
                "published": False if draft else published,
                **overrides,
            }
        ),
    )


def _do_export(client, token):
    resp = client.get(EXPORT, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestAuthRequired:
    def test_export_requires_reader_token(self, client):
        assert client.get(EXPORT).status_code == 401

    def test_admin_token_rejected(self, client, admin_token):
        resp = client.get(EXPORT, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 401


class TestExport:
    def test_empty_bundle(self, client):
        token = _token(client)
        body = _do_export(client, token)
        assert body["account"]["email"] == "exporter@example.com"
        assert body["bookmarks"] == []
        assert body["comments"] == []
        assert body["history"] == []
        assert "exported_at" in body

    def test_includes_bookmarks_and_folder(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session, title="Saved", slug="saved-post")
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        fid = client.post(FOLDERS, json={"name": "Tech"}, headers=_auth(token)).json()["id"]
        client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))

        body = _do_export(client, token)
        assert len(body["bookmarks"]) == 1
        b = body["bookmarks"][0]
        assert b["post_id"] == post.id
        assert b["slug"] == "saved-post"
        assert b["folder_name"] == "Tech"

    def test_includes_own_comments(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "x", "email": "x@x.com", "content": "my note"},
            headers=_auth(token),
        )
        assert created.status_code == 201, created.text

        body = _do_export(client, token)
        assert len(body["comments"]) == 1
        c = body["comments"][0]
        assert c["post_slug"] == post.slug
        assert c["content"] == "my note"
        assert c["status"] in {"approved", "pending", "rejected"}

    def test_includes_reading_history(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))

        body = _do_export(client, token)
        assert len(body["history"]) == 1
        h = body["history"][0]
        assert h["post_id"] == post.id
        assert h["slug"] == post.slug
        assert h["viewed_at"] is not None

    def test_export_is_scoped_to_caller(self, client, db_session):
        t1 = _token(client, email="iso1@example.com")
        t2 = _token(client, email="iso2@example.com")
        post = _create_post(db_session)
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        client.post(f"{HISTORY}/{post.id}", headers=_auth(t1))

        body1 = _do_export(client, t1)
        assert len(body1["bookmarks"]) == 1
        assert len(body1["history"]) == 1

        body2 = _do_export(client, t2)
        assert body2["bookmarks"] == []
        assert body2["history"] == []
        assert body2["account"]["email"] == "iso2@example.com"

    def test_non_visible_posts_excluded(self, client, db_session):
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = _token(client)
        post = _create_post(db_session)
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert len(_do_export(client, token)["bookmarks"]) == 1

        update_post(db_session, post.id, PostUpdate(published=False))
        body = _do_export(client, token)
        assert body["bookmarks"] == []
        assert body["history"] == []
