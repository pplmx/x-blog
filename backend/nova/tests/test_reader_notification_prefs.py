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

import pytest
from sqlalchemy import func, select

PREFS = "/api/reader/me/notification-preferences"
NOTIFS = "/api/reader/me/notifications"


async def _register(client, email="pref@example.com", password="readerpass123"):
    return await client.post("/api/reader/register", json={"email": email, "password": password})


async def _token(client, email="pref@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _opt_out(client, token, kind):
    resp = await client.patch(PREFS, json={"kind": kind, "enabled": False}, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _opt_in(client, token, kind):
    resp = await client.patch(PREFS, json={"kind": kind, "enabled": True}, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _comment_mention(client, post_id, name):
    """Post a guest comment that @-mentions ``name`` (pending moderation)."""
    resp = await client.post(
        f"/api/comments/post/{post_id}",
        json={"nickname": "Mentioner", "email": "mentioner@example.com", "content": f"Hey @{name}!"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _approve(client, auth_headers, comment_id):
    resp = await client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


async def _register_named(client, name, email):
    resp = await client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


async def _create_post(db_session, **overrides):
    from app.repositories import create_post
    from app.schemas import PostCreate

    return await create_post(
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
    async def test_get_requires_reader_token(self, client):
        assert (await client.get(PREFS)).status_code == 401

    async def test_patch_requires_reader_token(self, client):
        assert (await client.patch(PREFS, json={"kind": "reply", "enabled": False})).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        assert (await client.get(PREFS, headers={"Authorization": f"Bearer {admin_token}"})).status_code == 401


class TestPrefsContract:
    async def test_defaults_all_on(self, client):
        token = await _token(client)
        data = (await client.get(PREFS, headers=_auth(token))).json()
        assert data == {
            "new_post": True,
            "reply": True,
            "thread_comment": True,
            "mention": True,
            "reader_comment": True,
            "email_new_post": False,
            "email_reply": False,
            "email_thread_comment": False,
            "email_mention": False,
            "email_weekly_digest": False,
        }

    async def test_toggle_off_persists_and_back_on(self, client):
        token = await _token(client)
        headers = _auth(token)
        data = await _opt_out(client, token, "reply")
        assert data["reply"] is False
        assert data["new_post"] is True
        assert data["thread_comment"] is True
        # persisted server-side: a fresh GET reflects it, and other kinds are untouched.
        again = (await client.get(PREFS, headers=headers)).json()
        assert again == {
            "new_post": True,
            "reply": False,
            "thread_comment": True,
            "mention": True,
            "reader_comment": True,
            "email_new_post": False,
            "email_reply": False,
            "email_thread_comment": False,
            "email_mention": False,
            "email_weekly_digest": False,
        }
        # back on
        on = await client.patch(PREFS, json={"kind": "reply", "enabled": True}, headers=headers)
        assert on.status_code == 200
        assert on.json()["reply"] is True

    async def test_unknown_kind_422(self, client):
        token = await _token(client)
        resp = await client.patch(PREFS, json={"kind": "spam", "enabled": False}, headers=_auth(token))
        assert resp.status_code == 422

    async def test_reader_isolation(self, client):
        token_a = await _token(client, email="iso-a@example.com")
        token_b = await _token(client, email="iso-b@example.com")
        await _opt_out(client, token_a, "thread_comment")
        data_b = (await client.get(PREFS, headers=_auth(token_b))).json()
        assert data_b == {
            "new_post": True,
            "reply": True,
            "thread_comment": True,
            "mention": True,
            "reader_comment": True,
            "email_new_post": False,
            "email_reply": False,
            "email_thread_comment": False,
            "email_mention": False,
            "email_weekly_digest": False,
        }


class TestDispatchGating:
    async def test_new_post_off_skips_inbox_row(self, client, auth_headers):
        token = await _token(client, email="g-new@example.com")
        headers = _auth(token)
        await _opt_out(client, token, "new_post")

        cat = await client.post("/api/categories", json={"name": "PrefCat"}, headers=auth_headers)
        assert cat.status_code == 201, cat.text
        cat_id = cat.json()["id"]
        f = await client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        post = await client.post(
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

        data = (await client.get(NOTIFS, headers=headers)).json()
        assert data["total"] == 0

    async def test_reply_off_skips_inbox_row(self, client, db_session, auth_headers):
        token = await _token(client, email="g-reply@example.com")
        headers = _auth(token)
        await _opt_out(client, token, "reply")

        post = await _create_post(db_session)
        parent = await client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "parent pref", "nickname": "P", "email": "p@example.com"},
            headers=headers,
        )
        assert parent.status_code == 201, parent.text
        from app import models

        parent_row = (
            await db_session.execute(select(models.Comment).where(models.Comment.content == "parent pref"))
        ).scalar_one_or_none()
        assert parent_row is not None
        ap = await client.patch(f"/api/comments/{parent_row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ap.status_code == 200, ap.text

        replier_token = (await _register(client, email="g-replier@example.com")).json()["access_token"]
        reply = await client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "a pref reply", "nickname": "R", "email": "r@example.com", "parent_id": parent_row.id},
            headers=_auth(replier_token),
        )
        assert reply.status_code == 201, reply.text
        reply_row = (
            await db_session.execute(select(models.Comment).where(models.Comment.content == "a pref reply"))
        ).scalar_one_or_none()
        assert reply_row is not None
        ar = await client.patch(f"/api/comments/{reply_row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ar.status_code == 200, ar.text

        data = (await client.get(NOTIFS, headers=headers)).json()
        assert data["total"] == 0

    async def test_thread_comment_off_skips_inbox_row(self, client, db_session, auth_headers):
        token = await _token(client, email="g-thread@example.com")
        headers = _auth(token)
        await _opt_out(client, token, "thread_comment")

        post = await _create_post(db_session)
        sub = await client.put(f"/api/posts/{post.id}/subscription", headers=headers)
        assert sub.status_code in (200, 201), sub.text

        other = (await _register(client, email="g-other@example.com")).json()["access_token"]
        created = await client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "new pref comment", "nickname": "O", "email": "o@example.com"},
            headers=_auth(other),
        )
        assert created.status_code == 201, created.text
        from app import models

        row = (
            await db_session.execute(select(models.Comment).where(models.Comment.content == "new pref comment"))
        ).scalar_one_or_none()
        assert row is not None
        ap = await client.patch(f"/api/comments/{row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ap.status_code == 200, ap.text

        data = (await client.get(NOTIFS, headers=headers)).json()
        assert data["total"] == 0


class TestEmailChannel:
    """Email channel (DEC-197, TASK-217): opt-in per-kind SMTP copy of the fan-out."""

    _class_smtp_sent: list = []

    @pytest.fixture(autouse=True)
    def _email_sink(self, monkeypatch: pytest.MonkeyPatch):
        captured: list = []
        TestEmailChannel._class_smtp_sent = captured

        class FakeSMTP:
            def __init__(self, host, port, timeout=None):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return None

            def starttls(self, context=None):
                return True

            def login(self, user, password):
                return True

            def send_message(self, msg):
                captured.append(msg)

        monkeypatch.setattr("app.emailer.smtplib.SMTP", FakeSMTP)
        monkeypatch.setenv("SMTP_HOST", "smtp.test.example")
        monkeypatch.setenv("SMTP_FROM", "blog@example.com")
        monkeypatch.setenv("SITE_URL", "https://blog.example.com")

    async def test_defaults_email_off(self, client):
        token = await _token(client, email="mail-default@example.com")
        data = (await client.get(PREFS, headers=_auth(token))).json()
        assert data["email_new_post"] is False
        assert data["email_reply"] is False
        assert data["email_thread_comment"] is False
        assert data["new_post"] is True  # push/inbox side stays all-on

    async def test_email_kind_toggle_round_trip(self, client):
        token = await _token(client, email="mail-toggle@example.com")
        headers = _auth(token)
        patched = await client.patch(PREFS, json={"kind": "email_new_post", "enabled": True}, headers=headers)
        assert patched.status_code == 200, patched.text
        assert patched.json()["email_new_post"] is True
        assert patched.json()["email_reply"] is False
        # Persisted across a fresh GET.
        got = (await client.get(PREFS, headers=headers)).json()
        assert got["email_new_post"] is True
        # And back off.
        off = await client.patch(PREFS, json={"kind": "email_new_post", "enabled": False}, headers=headers)
        assert off.json()["email_new_post"] is False

    async def test_email_off_by_default_skips_email_but_inbox_row_still_lands(self, client, auth_headers, db_session):
        token = await _token(client, email="mail-off@example.com")
        headers = _auth(token)
        cat = await client.post("/api/categories", json={"name": "MailOffCat"}, headers=auth_headers)
        await client.put(f"/api/reader/me/categories/{cat.json()['id']}/follow", headers=headers)

        post = await client.post(
            "/api/posts",
            json={
                "title": "Mail gated",
                "slug": "mail-gated-new",
                "content": "c",
                "published": True,
                "category_id": cat.json()["id"],
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text
        # No SMTP emails for a reader who never opted in.
        assert TestEmailChannel._class_smtp_sent == []
        # ...but the durable inbox row still exists (push/inbox unaffected).
        assert (await client.get(NOTIFS, headers=headers)).json()["total"] == 1

    async def test_email_new_post_on_fans_out_email(self, client, auth_headers, db_session):
        token = await _token(client, email="mail-on@example.com")
        headers = _auth(token)
        await client.patch(PREFS, json={"kind": "email_new_post", "enabled": True}, headers=headers)
        cat = await client.post("/api/categories", json={"name": "MailOnCat"}, headers=auth_headers)
        await client.put(f"/api/reader/me/categories/{cat.json()['id']}/follow", headers=headers)

        await client.post(
            "/api/posts",
            json={
                "title": "Mail fan out",
                "slug": "mail-fanout",
                "content": "c",
                "published": True,
                "category_id": cat.json()["id"],
            },
            headers=auth_headers,
        )
        assert len(TestEmailChannel._class_smtp_sent) == 1, TestEmailChannel._class_smtp_sent
        assert TestEmailChannel._class_smtp_sent[0]["To"] == "mail-on@example.com"
        assert TestEmailChannel._class_smtp_sent[0]["Subject"] == "新文章发布"
        # And the inbox row lands too.
        assert (await client.get(NOTIFS, headers=headers)).json()["total"] == 1

    async def test_mention_email_off_by_default_skips_email_but_inbox_row_lands(self, client, auth_headers, db_session):
        token = await _register_named(client, "MailMentionDefault", "mail-mention-default@example.com")
        post = await _create_post(db_session, published=True)
        cid = await _comment_mention(client, post.id, "MailMentionDefault")
        await _approve(client, auth_headers, cid)
        assert TestEmailChannel._class_smtp_sent == []
        rows = (await client.get(NOTIFS, headers=_auth(token))).json()
        assert any(i["kind"] == "mention" for i in rows["items"])

    async def test_mention_email_on_fans_out_email_and_inbox_row(self, client, auth_headers, db_session):
        token = await _register_named(client, "MailMentionOn", "mail-mention-on@example.com")
        await _opt_in(client, token, "email_mention")
        post = await _create_post(db_session, published=True)
        cid = await _comment_mention(client, post.id, "MailMentionOn")
        await _approve(client, auth_headers, cid)
        assert len(TestEmailChannel._class_smtp_sent) == 1, TestEmailChannel._class_smtp_sent
        assert TestEmailChannel._class_smtp_sent[0]["To"] == "mail-mention-on@example.com"
        assert TestEmailChannel._class_smtp_sent[0]["Subject"] == "有人在评论中提到了你"
        rows = (await client.get(NOTIFS, headers=_auth(token))).json()
        assert any(i["kind"] == "mention" for i in rows["items"])

    async def test_mention_email_independent_of_inbox_opt_out(self, client, auth_headers, db_session):
        # Turning the in-app 'mention' kind OFF silences inbox + push (DEC-322)
        # but must NOT silence the separately-opted email copy (DEC-326): the
        # two channels are gated by different prefs.
        token = await _register_named(client, "MailMentionSplit", "mail-mention-split@example.com")
        await _opt_out(client, token, "mention")
        await _opt_in(client, token, "email_mention")
        post = await _create_post(db_session, published=True)
        cid = await _comment_mention(client, post.id, "MailMentionSplit")
        await _approve(client, auth_headers, cid)
        assert len(TestEmailChannel._class_smtp_sent) == 1, TestEmailChannel._class_smtp_sent
        rows = (await client.get(NOTIFS, headers=_auth(token))).json()
        assert all(i["kind"] != "mention" for i in rows["items"])

    async def test_email_mention_defaults_off_and_toggles(self, client):
        token = await _token(client, email="mail-mention-pref@example.com")
        headers = _auth(token)
        assert (await client.get(PREFS, headers=headers)).json()["email_mention"] is False
        on = await client.patch(PREFS, json={"kind": "email_mention", "enabled": True}, headers=headers)
        assert on.json()["email_mention"] is True
        assert (await client.get(PREFS, headers=headers)).json()["email_mention"] is True
        off = await client.patch(PREFS, json={"kind": "email_mention", "enabled": False}, headers=headers)
        assert off.json()["email_mention"] is False


class TestConcurrentMaterializationRace:
    """The prefs row is materialized on the first read/write (reader_id PK).
    Concurrent first-touches must converge on one shared row rather than
    double-insert (the PK constraint races) — verified by the fact that a
    second writer on an existing row reuses it and the toggle lands exactly
    once. The defensive IntegrityError recovery in get/set is the belt-and-
    braces for the rare moment both insert at once."""

    async def test_get_reuses_existing_row(self, db_session, client):
        """GET on an already-materialized row is a pure read returning the
        same row — no second insert attempt."""
        from app import models
        from app import repositories as crud

        token = await _token(client)
        reader_id = (await client.get("/api/reader/me", headers=_auth(token))).json()["id"]

        first = await crud.get_reader_notification_prefs(db_session, reader_id)
        before = (
            await db_session.execute(select(func.count()).select_from(models.ReaderNotificationPref))
        ).scalar_one()
        second = await crud.get_reader_notification_prefs(db_session, reader_id)
        after = (await db_session.execute(select(func.count()).select_from(models.ReaderNotificationPref))).scalar_one()

        assert first.reader_id == second.reader_id == reader_id
        assert before == after == 1  # still exactly one row

    async def test_set_on_existing_row_lands_once(self, db_session, client):
        """A toggle on an already-materialized row updates the single row —
        the concurrent double-insert is exactly the case that would 500."""
        from app import models
        from app import repositories as crud

        token = await _token(client)
        reader_id = (await client.get("/api/reader/me", headers=_auth(token))).json()["id"]

        row = await crud.set_reader_notification_kind(db_session, reader_id, "new_post", False)
        assert row is not None and row.new_post is False
        rows = (
            (
                await db_session.execute(
                    select(models.ReaderNotificationPref).where(models.ReaderNotificationPref.reader_id == reader_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].new_post is False
