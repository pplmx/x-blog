"""Reader data-export contract tests (DEC-126, TASK-175).

GET /api/reader/me/export returns a portable JSON bundle scoped to the caller:
account profile, public-visible bookmarks (with folder), the reader's own
comments (any moderation status), and their public-visible reading history.
Nothing cross-reader, and no draft/scheduled-post leakage on bookmarks/history.
"""

from sqlalchemy import select

from app import models

EXPORT = "/api/reader/me/export"
BOOKMARKS = "/api/reader/me/bookmarks"
HISTORY = "/api/reader/me/history"
FOLDERS = f"{BOOKMARKS}/folders"


async def _register(client, email="exporter@example.com", password="readerpass123", display_name=None):
    payload = {"email": email, "password": password}
    if display_name:
        payload["display_name"] = display_name
    return await client.post("/api/reader/register", json=payload)


async def _token(client, email="exporter@example.com", display_name=None):
    return (await _register(client, email=email, display_name=display_name)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


async def _create_post(db_session, *, published=True, draft=False, **overrides):
    from app.repositories import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return await create_post(
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


async def _do_export(client, token):
    resp = await client.get(EXPORT, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestAuthRequired:
    async def test_export_requires_reader_token(self, client):
        assert (await client.get(EXPORT)).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        resp = await client.get(EXPORT, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 401


class TestExport:
    async def test_empty_bundle(self, client):
        token = await _token(client)
        body = await _do_export(client, token)
        assert body["account"]["email"] == "exporter@example.com"
        assert body["bookmarks"] == []
        assert body["comments"] == []
        assert body["history"] == []
        assert "exported_at" in body

    async def test_includes_bookmarks_and_folder(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session, title="Saved", slug="saved-post")
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        fid = (await client.post(FOLDERS, json={"name": "Tech"}, headers=_auth(token))).json()["id"]
        await client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))

        body = await _do_export(client, token)
        assert len(body["bookmarks"]) == 1
        b = body["bookmarks"][0]
        assert b["post_id"] == post.id
        assert b["slug"] == "saved-post"
        assert b["folder_name"] == "Tech"

    async def test_export_is_not_truncated_at_list_page_size(self, client, db_session):
        # The bookmarks LIST endpoint pages at a default 100 (max 100); the
        # portable data bundle must be complete, never silently cut to that
        # page size (RIL ISS-288). 105 bookmarks -> all 105 in the export,
        # while the list endpoint itself still pages at 100.
        token = await _token(client)
        for i in range(105):
            post = await _create_post(db_session, title=f"Saved {i}", slug=f"saved-{i}")
            await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))

        body = await _do_export(client, token)
        assert len(body["bookmarks"]) == 105
        assert {b["slug"] for b in body["bookmarks"]} == {f"saved-{i}" for i in range(105)}

        page = (await client.get(f"{BOOKMARKS}?limit=100", headers=_auth(token))).json()
        assert len(page["items"]) == 100  # list paging unchanged

    async def test_includes_own_comments(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)
        created = await client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": "x", "email": "x@x.com", "content": "my note"},
            headers=_auth(token),
        )
        assert created.status_code == 201, created.text

        body = await _do_export(client, token)
        assert len(body["comments"]) == 1
        c = body["comments"][0]
        assert c["post_slug"] == post.slug
        assert c["content"] == "my note"
        assert c["status"] in {"approved", "pending", "rejected"}

    async def test_includes_reading_history(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)
        await client.post(f"{HISTORY}/{post.id}", headers=_auth(token))

        body = await _do_export(client, token)
        assert len(body["history"]) == 1
        h = body["history"][0]
        assert h["post_id"] == post.id
        assert h["slug"] == post.slug
        assert h["viewed_at"] is not None

    async def test_export_is_scoped_to_caller(self, client, db_session):
        t1 = await _token(client, email="iso1@example.com")
        t2 = await _token(client, email="iso2@example.com")
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(t1))
        await client.post(f"{HISTORY}/{post.id}", headers=_auth(t1))

        body1 = await _do_export(client, t1)
        assert len(body1["bookmarks"]) == 1
        assert len(body1["history"]) == 1

        body2 = await _do_export(client, t2)
        assert body2["bookmarks"] == []
        assert body2["history"] == []
        assert body2["account"]["email"] == "iso2@example.com"

    async def test_non_visible_posts_excluded(self, client, db_session):
        from app.repositories import update_post
        from app.schemas import PostUpdate

        token = await _token(client)
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        await client.post(f"{HISTORY}/{post.id}", headers=_auth(token))
        assert len((await _do_export(client, token))["bookmarks"]) == 1

        await update_post(db_session, post.id, PostUpdate(published=False))
        body = await _do_export(client, token)
        assert body["bookmarks"] == []
        assert body["history"] == []


class TestExportCompleteness:
    """DEC-334/TASK-393: the export bundle must cover every reader-owned dataset —
    follows (category/tag/series), notification prefs, inbox notifications, and
    push subscriptions — not just account/bookmarks/comments/history."""

    async def _populated_reader(self, client, db_session, admin_headers):
        """A reader with one of everything, returned as (token, ids)."""
        from app.repositories import create_series

        token = await _token(client, email="populated@example.com")
        headers = _auth(token)

        # Category + follow
        cat = (await client.post("/api/categories", json={"name": "ExpCat"}, headers=admin_headers)).json()
        await client.put(f"/api/reader/me/categories/{cat['id']}/follow", headers=headers)

        # Tag + follow
        tag = (await client.post("/api/tags", json={"name": "exp-tag"}, headers=admin_headers)).json()
        await client.put(f"/api/reader/me/tags/{tag['id']}/follow", headers=headers)

        # Series + follow (create via crud to avoid route shape differences)
        from app.schemas import SeriesCreate

        series = await create_series(db_session, SeriesCreate(title="Exp Series", slug="exp-series"))
        await client.put(f"/api/reader/me/series/{series.id}/follow", headers=headers)

        # Notification prefs: flip one on and one off, turn email on
        await client.patch(
            "/api/reader/me/notification-preferences",
            json={"kind": "reply", "enabled": False},
            headers=headers,
        )
        await client.patch(
            "/api/reader/me/notification-preferences",
            json={"kind": "email_reply", "enabled": True},
            headers=headers,
        )

        # Inbox notification row (direct insert — export must reflect it regardless
        # of the dispatch path that wrote it)
        from datetime import UTC, datetime

        from app.auth import ReaderAccount

        reader_id = (
            await db_session.execute(select(ReaderAccount.id).where(ReaderAccount.email == "populated@example.com"))
        ).scalar_one()
        assert reader_id is not None
        db_session.add(
            models.ReaderNotification(
                reader_id=reader_id,
                kind="new_post",
                title="Exp notification",
                body="Declaration",
                url="/posts/exp-series",
                created_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

        # Push subscription (reader-bound; keys redacted in the export)
        import base64
        import secrets as _secrets

        unique = _secrets.token_hex(4)
        sub = await client.post(
            "/api/push/subscribe",
            json={
                "endpoint": f"https://fcm.exp-{unique}.invalid/abc",
                "keys": {
                    "p256dh": base64.urlsafe_b64encode(b"\x04" + bytes(range(64))).rstrip(b"=").decode(),
                    "auth": base64.urlsafe_b64encode(bytes(range(16))).rstrip(b"=").decode(),
                },
            },
            headers=headers,
        )
        assert sub.status_code == 200, sub.text
        return token, headers

    async def test_bundle_includes_follows(self, client, db_session, auth_headers):
        token, _ = await self._populated_reader(client, db_session, auth_headers)
        body = await _do_export(client, token)

        follows = body["follows"]
        assert [f["name"] for f in follows["categories"]] == ["ExpCat"]
        assert follows["categories"][0]["notify"] is True
        assert [t["name"] for t in follows["tags"]] == ["exp-tag"]
        assert [s["slug"] for s in follows["series"]] == ["exp-series"]

    async def test_bundle_includes_notification_prefs(self, client, db_session, auth_headers):
        token, _ = await self._populated_reader(client, db_session, auth_headers)
        body = await _do_export(client, token)

        prefs = body["notification_prefs"]
        assert prefs["reply"] is False  # flipped off above
        assert prefs["new_post"] is True  # untouched default
        assert prefs["email_reply"] is True  # flipped on above

    async def test_bundle_includes_inbox_notifications(self, client, db_session, auth_headers):
        token, _ = await self._populated_reader(client, db_session, auth_headers)
        body = await _do_export(client, token)

        notifs = body["notifications"]
        assert len(notifs) == 1
        assert notifs[0]["kind"] == "new_post"
        assert notifs[0]["url"] == "/posts/exp-series"

    async def test_bundle_includes_push_subscriptions_without_keys(self, client, db_session, auth_headers):
        token, _ = await self._populated_reader(client, db_session, auth_headers)
        body = await _do_export(client, token)

        subs = body["push_subscriptions"]
        assert len(subs) == 1
        assert subs[0]["endpoint"].startswith("https://fcm.exp-")
        # Cryptographic keys must never ride a data export (PII-adjacent secret
        # material, same bar as the comment reply-notify token).
        assert "p256dh" not in subs[0]
        assert "auth" not in subs[0]

    async def test_empty_reader_has_absent_sections(self, client):
        token = await _token(client, email="empty-export@example.com")
        body = await _do_export(client, token)
        assert body["follows"]["categories"] == []
        assert body["follows"]["tags"] == []
        assert body["follows"]["series"] == []
        assert body["notification_prefs"] is None
        assert body["notifications"] == []
        assert body["push_subscriptions"] == []
