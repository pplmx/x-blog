"""Reader notification-preference contract tests (DEC-171, TASK-202).

The blog fans out three notification kinds to a signed-in reader — new_post in a
followed series/category, a reply to their comment, a new comment on a followed
thread. A reader can now silence any kind globally (per-type preferences, on top
of the per-follow notify flags); when a kind is off every dispatch point skips
it — neither a durable inbox row nor a browser push. This suite covers: auth
scoping, all-on defaults, the toggle contract (unknown kind -> 422, reader
isolation, persistence), and the gate at each dispatch point (new_post on
publish, reply on comment-approval, thread_comment on comment-approval). The
browser-push gate for new_post lives in test_push_new_posts.py. Mirror the
inbox contract conventions.
"""

from uuid import uuid4

PREFS = "/api/reader/me/notification-preferences"
NOTIFS = "/api/reader/me/notifications"


def _register(client, email="pref@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="pref@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _opt_out(client, token, kind):
    resp = client.patch(PREFS, json={"kind": kind, "enabled": False}, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


def _create_post(db_session, **overrides):
    from app.crud import create_post
    from app.schemas import PostCreate

    return create_post(
        db_session,
        PostCreate(
            **{
                "title": "A post",
                "slug": f"pref-post-{uuid4().hex[:8]}",
                "content": "# Hi",
                "published": True,
                **overrides,
            }
        ),
    )


class TestAuthRequired:
    def test_get_requires_reader_token(self, client):
        assert client.get(PREFS).status_code == 401

    def test_patch_requires_reader_token(self, client):
        assert client.patch(PREFS, json={"kind": "reply", "enabled": False}).status_code == 401

    def test_admin_token_rejected(self, client, admin_token):
        assert client.get(PREFS, headers={"Authorization": f"Bearer {admin_token}"}).status_code == 401


class TestPrefsContract:
    def test_defaults_all_on(self, client):
        token = _token(client)
        data = client.get(PREFS, headers=_auth(token)).json()
        assert data == {"new_post": True, "reply": True, "thread_comment": True}

    def test_toggle_off_persists_and_back_on(self, client):
        token = _token(client)
        headers = _auth(token)
        data = _opt_out(client, token, "reply")
        assert data["reply"] is False
        assert data["new_post"] is True
        assert data["thread_comment"] is True
        # persisted server-side: a fresh GET reflects it, and other kinds are untouched.
        again = client.get(PREFS, headers=headers).json()
        assert again == {"new_post": True, "reply": False, "thread_comment": True}
        # back on
        on = client.patch(PREFS, json={"kind": "reply", "enabled": True}, headers=headers)
        assert on.status_code == 200
        assert on.json()["reply"] is True

    def test_unknown_kind_422(self, client):
        token = _token(client)
        resp = client.patch(PREFS, json={"kind": "spam", "enabled": False}, headers=_auth(token))
        assert resp.status_code == 422

    def test_reader_isolation(self, client):
        token_a = _token(client, email="iso-a@example.com")
        token_b = _token(client, email="iso-b@example.com")
        _opt_out(client, token_a, "thread_comment")
        data_b = client.get(PREFS, headers=_auth(token_b)).json()
        assert data_b == {"new_post": True, "reply": True, "thread_comment": True}


class TestDispatchGating:
    def test_new_post_off_skips_inbox_row(self, client, auth_headers):
        token = _token(client, email="g-new@example.com")
        headers = _auth(token)
        _opt_out(client, token, "new_post")

        cat = client.post("/api/categories", json={"name": "PrefCat"}, headers=auth_headers)
        assert cat.status_code == 201, cat.text
        cat_id = cat.json()["id"]
        f = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Gated out",
                "slug": "pref-gated-new",
                "content": "c",
                "published": True,
                "category_id": cat_id,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 0

    def test_reply_off_skips_inbox_row(self, client, db_session, auth_headers):
        token = _token(client, email="g-reply@example.com")
        headers = _auth(token)
        _opt_out(client, token, "reply")

        post = _create_post(db_session)
        parent = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "parent pref", "nickname": "P", "email": "p@example.com"},
            headers=headers,
        )
        assert parent.status_code == 201, parent.text
        from app import models

        parent_row = db_session.query(models.Comment).filter_by(content="parent pref").first()
        assert parent_row is not None
        ap = client.patch(f"/api/comments/{parent_row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ap.status_code == 200, ap.text

        replier_token = _register(client, email="g-replier@example.com").json()["access_token"]
        reply = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "a pref reply", "nickname": "R", "email": "r@example.com", "parent_id": parent_row.id},
            headers=_auth(replier_token),
        )
        assert reply.status_code == 201, reply.text
        reply_row = db_session.query(models.Comment).filter_by(content="a pref reply").first()
        assert reply_row is not None
        ar = client.patch(f"/api/comments/{reply_row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ar.status_code == 200, ar.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 0

    def test_thread_comment_off_skips_inbox_row(self, client, db_session, auth_headers):
        token = _token(client, email="g-thread@example.com")
        headers = _auth(token)
        _opt_out(client, token, "thread_comment")

        post = _create_post(db_session)
        sub = client.put(f"/api/posts/{post.id}/subscription", headers=headers)
        assert sub.status_code in (200, 201), sub.text

        other = _register(client, email="g-other@example.com").json()["access_token"]
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "new pref comment", "nickname": "O", "email": "o@example.com"},
            headers=_auth(other),
        )
        assert created.status_code == 201, created.text
        from app import models

        row = db_session.query(models.Comment).filter_by(content="new pref comment").first()
        assert row is not None
        ap = client.patch(f"/api/comments/{row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ap.status_code == 200, ap.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 0
