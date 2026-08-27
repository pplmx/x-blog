"""Admin reader management contract tests (DEC-194, TASK-214, ISS-116).

Reader accounts shipped as a fully reader-facing arc — self-registration,
bookmarks, comment history, trust-tier auto-approve (DEC-098) and self-service
account deletion — but no operator surface exists: there is no admin list of
registered readers and no mechanism to deactivate an account. Because the trust
tier auto-approves every verified reader's comment, a script-registered account
can publish unmoderated with no operator mechanism to stop it.

Contract under test:
- GET  /api/admin/readers            admin-only, paginated list with q filter and
                                     per-reader comment/bookmark counts
- POST /api/admin/readers/{id}/deactivate  sets is_active=False and bumps
                                     token_version so every live reader JWT dies
- POST /api/admin/readers/{id}/activate    restores the account (must re-login)
- a deactivated reader: login -> 403, /api/reader/me -> 403, and the optional
  reader identity resolves to None, so the trust-tier auto-approve path cannot
  be gamed through a deactivated account
"""

import uuid

from app import models
from app.auth import create_reader_token

REGISTER = "/api/reader/register"
LOGIN = "/api/reader/login"
ME = "/api/reader/me"
ADMIN_READERS = "/api/admin/readers"


def _register(client, email=None, password="readerpass123", display_name=None):
    body = {
        "email": email or f"r{uuid.uuid4().hex[:10]}@example.com",
        "password": password,
        **({"display_name": display_name} if display_name else {}),
    }
    resp = client.post(REGISTER, json=body)
    assert resp.status_code == 201, f"register failed: {resp.status_code} {resp.text[:300]}"
    return resp


def _reader_headers(resp):
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


def _seed_public_post(db_session, slug="admin-readers-post"):
    post = models.Post(title="Admin readers post", slug=slug, content="x", published=True, publish_at=None)
    db_session.add(post)
    db_session.commit()
    db_session.refresh(post)
    return post


def _post_comment(client, post_id, headers=None, content="hello"):
    body = {"nickname": "n", "email": "e@example.com", "content": content}
    return client.post(f"/api/comments/post/{post_id}", json=body, headers=headers)


class TestListReaders:
    def test_anonymous_forbidden(self, client):
        assert client.get(ADMIN_READERS).status_code == 401

    def test_reader_token_forbidden(self, client):
        r = _register(client)
        assert r.status_code == 201
        # A reader-scoped token (aud=x-blog-reader) is rejected by the admin
        # guard as invalid credentials (401) — the audience separation of
        # DEC-059 means it is never even recognized as a valid-but-forbidden
        # identity, so the reader token cannot reach the readers list.
        assert client.get(ADMIN_READERS, headers=_reader_headers(r)).status_code == 401

    def test_list_returns_reader_rows(self, client, auth_headers):
        _register(client, email="list0@example.com")
        _register(client, email="list1@example.com")
        data = client.get(ADMIN_READERS, headers=auth_headers).json()
        assert data["pagination"]["total"] == 2
        assert {row["email"] for row in data["items"]} == {"list0@example.com", "list1@example.com"}
        row = data["items"][0]
        required = {
            "id",
            "email",
            "display_name",
            "is_active",
            "created_at",
            "last_login_at",
            "comment_count",
            "bookmark_count",
        }
        assert required <= set(row)
        assert row["is_active"] is True

    def test_list_counts_comments_and_bookmarks(self, client, auth_headers, db_session):
        r = _register(client, email="counter@example.com")
        reader_id = r.json()["reader"]["id"]
        post = _seed_public_post(db_session)
        db_session.add(
            models.Comment(
                post_id=post.id,
                nickname="c",
                content="hi",
                ip_address="x",
                is_approved=True,
                reader_id=reader_id,
            )
        )
        db_session.add(models.ReaderBookmark(reader_id=reader_id, post_id=post.id))
        db_session.commit()
        data = client.get(ADMIN_READERS, headers=auth_headers).json()
        row = next(x for x in data["items"] if x["email"] == "counter@example.com")
        assert row["comment_count"] == 1
        assert row["bookmark_count"] == 1

    def test_list_q_filters_email_and_display_name(self, client, auth_headers):
        _register(client, email="alice@example.com", display_name="Alice")
        _register(client, email="bob@example.com", display_name="Robert")
        q_alice = client.get(ADMIN_READERS, params={"q": "alice"}, headers=auth_headers).json()
        assert [x["email"] for x in q_alice["items"]] == ["alice@example.com"]
        q_robert = client.get(ADMIN_READERS, params={"q": "Robert"}, headers=auth_headers).json()
        assert [x["email"] for x in q_robert["items"]] == ["bob@example.com"]

    def test_list_pagination(self, client, auth_headers):
        for i in range(3):
            _register(client, email=f"pg{i}@example.com")
        page1 = client.get(ADMIN_READERS, params={"page": 1, "limit": 2}, headers=auth_headers).json()
        assert page1["pagination"]["total"] == 3
        assert len(page1["items"]) == 2
        page2 = client.get(ADMIN_READERS, params={"page": 2, "limit": 2}, headers=auth_headers).json()
        assert len(page2["items"]) == 1


class TestDeactivate:
    def test_requires_admin_auth(self, client):
        r = _register(client)
        rid = r.json()["reader"]["id"]
        # reader token rejected as invalid credentials (401) by the admin guard
        assert client.post(f"{ADMIN_READERS}/{rid}/deactivate", headers=_reader_headers(r)).status_code == 401

    def test_deactivate_blocks_login_and_live_token(self, client, auth_headers):
        email = f"victim-{uuid.uuid4().hex[:8]}@example.com"
        r = _register(client, email=email, password="readerpass123")
        rid = r.json()["reader"]["id"]
        assert client.get(ME, headers=_reader_headers(r)).status_code == 200
        resp = client.post(f"{ADMIN_READERS}/{rid}/deactivate", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_active"] is False
        # every previously issued JWT is revoked immediately: deactivation bumps
        # token_version, so the old token no longer matches -> 401 (revoked)
        assert client.get(ME, headers=_reader_headers(r)).status_code == 401
        # even a freshly minted token at the CURRENT token_version cannot
        # authenticate: the is_active guard itself rejects the account -> 403
        fresh = client.get(
            ME, headers={"Authorization": f"Bearer {create_reader_token({'sub': rid}, token_version=1)}"}
        )
        assert fresh.status_code == 403
        # and the account can no longer sign in
        login = client.post(LOGIN, json={"email": email, "password": "readerpass123"})
        assert login.status_code == 403

    def test_activate_restores_login(self, client, auth_headers):
        email = f"revive-{uuid.uuid4().hex[:8]}@example.com"
        r = _register(client, email=email, password="readerpass123")
        rid = r.json()["reader"]["id"]
        client.post(f"{ADMIN_READERS}/{rid}/deactivate", headers=auth_headers)
        resp = client.post(f"{ADMIN_READERS}/{rid}/activate", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_active"] is True
        # old tokens stay dead (token_version was bumped at deactivation,
        # not rolled back on activate) — the reader must log in again
        assert client.get(ME, headers=_reader_headers(r)).status_code == 401
        login = client.post(LOGIN, json={"email": email, "password": "readerpass123"})
        assert login.status_code == 200, login.text
        assert client.get(ME, headers=_reader_headers(login)).status_code == 200

    def test_deactivate_unknown_reader_404(self, client, auth_headers):
        assert client.post(f"{ADMIN_READERS}/999999/deactivate", headers=auth_headers).status_code == 404

    def test_editor_can_deactivate(self, client, editor_headers):
        r = _register(client, email="ed@example.com")
        rid = r.json()["reader"]["id"]
        assert client.post(f"{ADMIN_READERS}/{rid}/deactivate", headers=editor_headers).status_code == 200


class TestDeactivatedReaderIdentity:
    def test_deactivated_token_is_anonymous_on_comment(self, client, auth_headers, db_session):
        email = f"ghost-{uuid.uuid4().hex[:8]}@example.com"
        r = _register(client, email=email, display_name="Ghost")
        rid = r.json()["reader"]["id"]
        post = _seed_public_post(db_session)
        # as a live reader the comment carries the verified identity
        live = _post_comment(client, post.id, headers=_reader_headers(r))
        assert live.status_code == 201, live.text
        assert live.json()["reader"] is not None
        # deactivate; the same token now resolves to anonymous identity, so a
        # comment from it is NOT reader-stamped and cannot take the trust-tier
        # auto-approve path
        client.post(f"{ADMIN_READERS}/{rid}/deactivate", headers=auth_headers)
        anon = _post_comment(client, post.id, headers=_reader_headers(r), content="still here")
        assert anon.status_code == 201, anon.text
        assert anon.json()["reader"] is None
