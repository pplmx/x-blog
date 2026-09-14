"""Reader notification-inbox contract tests (DEC-160, TASK-192).

The blog persists one durable notification row per reader-facing notification
event (new post in a followed series/category, a reply to the reader's comment,
a new comment on a followed thread) so a signed-in reader can review activity
they missed — independent of fire-and-forget browser push. This suite covers:
auth scoping, list newest-first with read/unread, unread count badge, mark-one-
read and mark-all-read, reader isolation, and the persistence hooks that fire at
the existing dispatch points (new-post on create/update, reply on approval,
thread-comment on approval). Mirror the bookmark/history contract conventions.
"""

from uuid import uuid4

NOTIFS = "/api/reader/me/notifications"
PREFS = "/api/reader/me/notification-preferences"


def _register(client, email="n@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="n@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _tag_id(client, name):
    """Resolve a tag's id from the public /api/tags listing by name."""
    tags = client.get("/api/tags").json()
    for tag in tags:
        if tag["name"] == name:
            return tag["id"]
    raise AssertionError(f"tag {name!r} not found in /api/tags")


def _create_post(db_session, **overrides):
    from app.crud import create_post
    from app.schemas import PostCreate

    return create_post(
        db_session,
        PostCreate(
            **{
                "title": "A post",
                "slug": f"notif-post-{uuid4().hex[:8]}",
                "content": "# Hi",
                "published": True,
                **overrides,
            }
        ),
    )


class TestAuthRequired:
    def test_list_requires_reader_token(self, client):
        assert client.get(NOTIFS).status_code == 401

    def test_mark_read_requires_reader_token(self, client):
        assert client.post(f"{NOTIFS}/1/read").status_code == 401

    def test_read_all_requires_reader_token(self, client):
        assert client.post(f"{NOTIFS}/read-all").status_code == 401

    def test_admin_token_rejected(self, client, admin_token):
        assert client.get(NOTIFS, headers={"Authorization": f"Bearer {admin_token}"}).status_code == 401


class TestListAndMarkRead:
    def test_empty_inbox(self, client):
        token = _token(client)
        resp = client.get(NOTIFS, headers=_auth(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0
        assert data["unread"] == 0

    def test_lists_newest_first_and_counts_unread(self, client, db_session):
        # Use the registered reader's real id — PG does not give the first
        # registration in a batch id 1 (sequences advance on rollback).
        reg = _register(client, email="list@example.com")
        token = reg.json()["access_token"]
        rid = reg.json()["reader"]["id"]
        headers = _auth(token)
        from app import models

        first = models.ReaderNotification(reader_id=rid, kind="reply", title="t1", body="b1", url="/posts/x#c1")
        second = models.ReaderNotification(reader_id=rid, kind="new_post", title="t2", body="b2", url="/posts/y")
        db_session.add_all([first, second])
        db_session.commit()

        resp = client.get(NOTIFS, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["unread"] == 2
        # newest first by id (second has a later id)
        assert [i["title"] for i in data["items"]] == ["t2", "t1"]

        # mark the newest read -> unread drops to 1
        first_id = data["items"][0]["id"]
        r = client.post(f"{NOTIFS}/{first_id}/read", headers=headers)
        assert r.status_code == 200
        assert r.json()["read"] is True

        again = client.get(NOTIFS, headers=headers)
        assert again.json()["unread"] == 1

    def test_unread_filter(self, client, db_session):
        reg = _register(client, email="unread@example.com")
        token = reg.json()["access_token"]
        rid = reg.json()["reader"]["id"]
        headers = _auth(token)
        from datetime import datetime

        from app import models

        db_session.add(models.ReaderNotification(reader_id=rid, kind="reply", title="unread1"))
        db_session.add(
            models.ReaderNotification(reader_id=rid, kind="reply", title="read1", read_at=datetime(2026, 1, 1))
        )
        db_session.commit()

        resp = client.get(NOTIFS, params={"unread": "true"}, headers=headers)
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["title"] == "unread1"
        assert data["unread"] == 1

    def test_read_all(self, client, db_session):
        reg = _register(client, email="all@example.com")
        token = reg.json()["access_token"]
        rid = reg.json()["reader"]["id"]
        headers = _auth(token)
        from app import models

        db_session.add(models.ReaderNotification(reader_id=rid, kind="reply", title="a"))
        db_session.add(models.ReaderNotification(reader_id=rid, kind="reply", title="b"))
        db_session.commit()

        resp = client.post(f"{NOTIFS}/read-all", headers=headers)
        assert resp.status_code == 200
        assert resp.json() == {"updated": 2}
        data = client.get(NOTIFS, headers=headers).json()
        assert data["unread"] == 0
        assert all(i["read"] for i in data["items"])

    def test_mark_read_scoped_to_owner(self, client, db_session):
        _register(client, email="other@example.com")
        token_b = _register(client, email="other2@example.com").json()["access_token"]
        from app import models

        db_session.add(models.ReaderNotification(reader_id=1, kind="reply", title="mine"))
        db_session.commit()
        nid = db_session.query(models.ReaderNotification).first().id

        # A different reader (id 2) cannot mark or see it
        assert client.post(f"{NOTIFS}/{nid}/read", headers=_auth(token_b)).status_code == 404
        other = client.get(NOTIFS, headers=_auth(token_b)).json()
        assert other["total"] == 0

    def test_mark_read_oversized_id_is_422_not_500(self, client):
        # A 20+ digit id used to bind an out-of-range Python int and 500 on both
        # dialects (sqlite OverflowError / psycopg out-of-range); the shared IdInt
        # alias bounds it to 32-bit so this is a clean 422 (round-296 deep-dive).
        token = _register(client, email="bigid@example.com").json()["access_token"]
        response = client.post(f"{NOTIFS}/99999999999999999999/read", headers=_auth(token))
        assert response.status_code == 422


class TestDeleteNotification:
    """Deleting a single inbox row (DEC-312, TASK-384).

    The inbox is durable (DEC-160) but the reader could never prune it — mark
    read/read-all only clears the badge, rows accumulate forever. DELETE removes
    exactly one of the reader's own rows (404 for unknown or another reader's).
    """

    def test_delete_requires_reader_token(self, client):
        assert client.delete(f"{NOTIFS}/1").status_code == 401

    def test_delete_own_notification(self, client, db_session):
        reg = _register(client, email="del@example.com")
        token = reg.json()["access_token"]
        rid = reg.json()["reader"]["id"]
        headers = _auth(token)
        from app import models

        db_session.add(models.ReaderNotification(reader_id=rid, kind="reply", title="k1"))
        db_session.add(models.ReaderNotification(reader_id=rid, kind="new_post", title="k2"))
        db_session.commit()
        nid = db_session.query(models.ReaderNotification).filter_by(title="k1").one().id

        resp = client.delete(f"{NOTIFS}/{nid}", headers=headers)
        assert resp.status_code == 204

        data = client.get(NOTIFS, headers=headers).json()
        assert [i["title"] for i in data["items"]] == ["k2"]
        assert data["total"] == 1
        # The row is gone from the table, not merely hidden.
        assert db_session.get(models.ReaderNotification, nid) is None

    def test_delete_other_reader_notification_is_404(self, client, db_session):
        from app import models

        owner = _register(client, email="owner@example.com").json()
        owner_id = owner["reader"]["id"]
        token_b = _register(client, email="otherdel@example.com").json()["access_token"]
        db_session.add(models.ReaderNotification(reader_id=owner_id, kind="reply", title="theirs"))
        db_session.commit()
        nid = db_session.query(models.ReaderNotification).filter_by(reader_id=owner_id).one().id

        assert client.delete(f"{NOTIFS}/{nid}", headers=_auth(token_b)).status_code == 404
        # Still present for its owner.
        assert db_session.get(models.ReaderNotification, nid) is not None

    def test_delete_unknown_is_404(self, client):
        token = _register(client, email="noid@example.com").json()["access_token"]
        assert client.delete(f"{NOTIFS}/999999", headers=_auth(token)).status_code == 404

    def test_delete_oversized_id_is_422_not_500(self, client):
        token = _register(client, email="bigdel@example.com").json()["access_token"]
        response = client.delete(f"{NOTIFS}/99999999999999999999", headers=_auth(token))
        assert response.status_code == 422


class TestPersistenceHooks:
    def test_deactivated_follower_gets_no_inbox_row(self, client, db_session, auth_headers):
        """Deactivation is a moderation action: a deactivated reader keeps their
        follow rows but must not receive the durable inbox row (RIL ISS-278,
        DEC-194) — all notification channels go silent."""
        token = _token(client, email="deact@example.com")
        headers = _auth(token)

        cat = client.post("/api/categories", json={"name": "Quiet"}, headers=auth_headers)
        assert cat.status_code == 201, cat.text
        cat_id = cat.json()["id"]
        f = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        # Prove the follow actually delivers while active.
        client.post(
            "/api/posts",
            json={"title": "one", "slug": "deact-1", "content": "c", "published": True, "category_id": cat_id},
            headers=auth_headers,
        )
        assert client.get(NOTIFS, headers=headers).json()["total"] == 1

        # Deactivate the reader directly (is_active=False; the admin endpoint
        # goes through the same column). The follow rows stay intact.
        from app import models
        from app.auth import ReaderAccount

        ra = db_session.query(ReaderAccount).filter(ReaderAccount.email == "deact@example.com").one()
        ra.is_active = False
        db_session.commit()

        # A following-but-deactivated reader gets no new inbox row.
        client.post(
            "/api/posts",
            json={"title": "two", "slug": "deact-2", "content": "c", "published": True, "category_id": cat_id},
            headers=auth_headers,
        )
        rows = db_session.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == ra.id).all()
        assert len(rows) == 1  # only the pre-deactivation row
        # and the reader cannot even list (deactivated accounts are rejected).
        assert client.get(NOTIFS, headers=headers).status_code == 403

    def test_new_post_in_followed_category_persists(self, client, db_session, auth_headers):
        token = _token(client, email="cat@example.com")
        headers = _auth(token)

        # create a category + have the reader follow it (notify on)
        cat = client.post("/api/categories", json={"name": "AI"}, headers=auth_headers)
        assert cat.status_code == 201, cat.text
        cat_id = cat.json()["id"]
        f = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        # publish a new post in that category -> inbox row for the reader
        post = client.post(
            "/api/posts",
            json={
                "title": "Cat post",
                "slug": "cat-notif-post",
                "content": "c",
                "published": True,
                "category_id": cat_id,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 1
        assert data["items"][0]["kind"] == "new_post"
        assert data["items"][0]["url"] == "/posts/cat-notif-post"

    def test_restore_to_published_refans_out_to_followers(self, client, db_session, auth_headers):
        # publish -> unpublish -> history-restore of a published snapshot: the
        # restore makes the post publicly visible again, so the new-post fan-out
        # must fire exactly like any other publish transition (create/update/
        # admin-update all do). Restore was the silent miss — followers got no
        # inbox row on a legitimate republish (RIL ISS-291).
        token = _token(client, email="rst@example.com")
        headers = _auth(token)

        cat = client.post("/api/categories", json={"name": "RST"}, headers=auth_headers)
        assert cat.status_code == 201, cat.text
        cat_id = cat.json()["id"]
        follow = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert follow.status_code in (200, 201), follow.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Once visible",
                "slug": "rst-once",
                "content": "c",
                "published": True,
                "category_id": cat_id,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text
        post_id = post.json()["id"]
        assert client.get(NOTIFS, headers=headers).json()["total"] == 1  # published fan-out

        # Unpublish (-> draft): out of visibility, no additional fan-out.
        down = client.put(
            f"/api/admin/posts/{post_id}",
            json={"published": False},
            headers=auth_headers,
        )
        assert down.status_code == 200, down.text

        # Restore the create-time published snapshot (admin_update_post captures
        # AFTER commit, so the newest revision is the draft — the published one
        # is the oldest, mirroring test_admin_post_revisions).
        revisions = client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers).json()
        assert revisions, "create should capture a revision"
        restored = client.post(
            f"/api/admin/posts/{post_id}/revisions/{revisions[-1]['id']}/restore",
            headers=auth_headers,
        )
        assert restored.status_code == 200, restored.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 2
        assert sum(1 for item in data["items"] if item["url"] == "/posts/rst-once") == 2

    def test_new_post_in_followed_series_persists(self, client, db_session, auth_headers):
        token = _token(client, email="ser@example.com")
        headers = _auth(token)

        series = client.post(
            "/api/series",
            json={"title": "My Series", "slug": "notif-series", "description": "d"},
            headers=auth_headers,
        )
        assert series.status_code in (200, 201), series.text
        series_id = series.json()["id"]
        f = client.put(f"/api/reader/me/series/{series_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Part 1",
                "slug": "part-1",
                "content": "c",
                "published": True,
                "series_id": series_id,
                "series_order": 1,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 1
        assert data["items"][0]["url"] == "/posts/part-1"
        # A series follow surfaces the distinct series_new_part kind (ISS-114,
        # DEC-181): the frontend icons/labels it as 系列更新, never as 新文章发布.
        assert data["items"][0]["kind"] == "series_new_part"
        assert data["items"][0]["title"] == "系列更新"

    def test_series_and_category_dedup_to_one_series_row(self, client, db_session, auth_headers):
        """A reader following BOTH the series and the category of a post gets ONE
        new-part row, preferring series_new_part — not one row per follow
        (DEC-181 dedup)."""
        token = _token(client, email="both@example.com")
        headers = _auth(token)

        series = client.post(
            "/api/series",
            json={"title": "Both Series", "slug": "notif-both-series", "description": "d"},
            headers=auth_headers,
        )
        assert series.status_code in (200, 201), series.text
        series_id = series.json()["id"]
        f = client.put(f"/api/reader/me/series/{series_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        cat = client.post("/api/categories", json={"name": "BothCat"}, headers=auth_headers)
        assert cat.status_code == 201, cat.text
        cat_id = cat.json()["id"]
        c = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert c.status_code in (200, 201), c.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Both Part",
                "slug": "both-part",
                "content": "c",
                "published": True,
                "series_id": series_id,
                "series_order": 1,
                "category_id": cat_id,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 1
        assert data["items"][0]["kind"] == "series_new_part"
        assert data["items"][0]["url"] == "/posts/both-part"

    def test_series_new_part_respects_new_post_opt_out(self, client, db_session, auth_headers):
        """Under DEC-181 a series part is a new_post announcement (a series update
        IS a new post), so the existing new_post kill-switch silences it too —
        no separate toggle, no surprise wake-ups for opted-out readers."""
        token = _token(client, email="ser-off@example.com")
        headers = _auth(token)
        resp = client.patch(
            PREFS,
            json={"kind": "new_post", "enabled": False},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        series = client.post(
            "/api/series",
            json={"title": "Off Series", "slug": "notif-off-series", "description": "d"},
            headers=auth_headers,
        )
        assert series.status_code in (200, 201), series.text
        series_id = series.json()["id"]
        f = client.put(f"/api/reader/me/series/{series_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Off Part",
                "slug": "off-part",
                "content": "c",
                "published": True,
                "series_id": series_id,
                "series_order": 1,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 0

    def test_new_post_in_followed_tag_persists(self, client, db_session, auth_headers):
        """A reader following a tag gets a durable new_post inbox row when the
        author publishes a post carrying that tag (DEC-195, TASK-215). Tags are
        the fine-grained axis — the kind stays ``new_post`` (new article), not
        series_new_part."""
        token = _token(client, email="tag@example.com")
        headers = _auth(token)

        # seed a tag (a post auto-creates it), resolve its id, follow it
        seed = client.post(
            "/api/posts",
            json={"title": "Seed", "slug": "tag-seed", "content": "c", "published": True, "tags": ["rust"]},
            headers=auth_headers,
        )
        assert seed.status_code == 201, seed.text
        tag_id = _tag_id(client, "rust")
        f = client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Rust post",
                "slug": "tag-notif-post",
                "content": "c",
                "published": True,
                "tags": ["rust"],
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 1, data
        assert data["items"][0]["kind"] == "new_post"
        assert data["items"][0]["url"] == "/posts/tag-notif-post"

    def test_tag_follow_respects_new_post_opt_out(self, client, db_session, auth_headers):
        """Tag follow joins the same new_post umbrella (DEC-171/181): a reader
        who silenced new_post gets no inbox row for a followed tag's new post."""
        token = _token(client, email="tag-off@example.com")
        headers = _auth(token)
        resp = client.patch(
            PREFS,
            json={"kind": "new_post", "enabled": False},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        seed = client.post(
            "/api/posts",
            json={
                "title": "Seed Off",
                "slug": "tag-off-seed",
                "content": "c",
                "published": True,
                "tags": ["postgres"],
            },
            headers=auth_headers,
        )
        assert seed.status_code == 201, seed.text
        tag_id = _tag_id(client, "postgres")
        f = client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Pg post",
                "slug": "tag-off-post",
                "content": "c",
                "published": True,
                "tags": ["postgres"],
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 0

    def test_tag_and_category_dedup_to_one_row(self, client, db_session, auth_headers):
        """A reader following BOTH the tag and the category of a post gets ONE
        new_post row, not one per follow (mirrors the series+category dedup).

        The tag is created via the admin endpoint (not by a seeding post) so
        no stray fan-out row lands in the inbox before the assertion."""
        token = _token(client, email="tagcat@example.com")
        headers = _auth(token)

        cat = client.post("/api/categories", json={"name": "TagCat"}, headers=auth_headers)
        assert cat.status_code == 201, cat.text
        cat_id = cat.json()["id"]
        c = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert c.status_code in (200, 201), c.text

        tag = client.post("/api/tags", json={"name": "golang"}, headers=auth_headers)
        assert tag.status_code in (200, 201), tag.text
        tag_id = tag.json()["id"]
        f = client.put(f"/api/reader/me/tags/{tag_id}/follow", headers=headers)
        assert f.status_code in (200, 201), f.text

        post = client.post(
            "/api/posts",
            json={
                "title": "Go post",
                "slug": "tagcat-post",
                "content": "c",
                "published": True,
                "category_id": cat_id,
                "tags": ["golang"],
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 1, data
        assert data["items"][0]["kind"] == "new_post"
        assert data["items"][0]["url"] == "/posts/tagcat-post"

    def test_reply_notification_persists_on_approval(self, client, db_session, auth_headers):
        token = _token(client, email="parent@example.com")
        headers = _auth(token)
        post = _create_post(db_session)
        # Parent reader comments; every comment starts pending.
        parent = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "parent comment", "nickname": "P", "email": "p@example.com"},
            headers=headers,
        )
        assert parent.status_code == 201, parent.text
        from app import models

        parent_row = db_session.query(models.Comment).filter_by(content="parent comment").first()
        assert parent_row is not None

        # The parent must be approved before another reader can reply to it
        # (replies to pending comments are rejected — crud.create_comment).
        ap = client.patch(f"/api/comments/{parent_row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ap.status_code == 200, ap.text

        # Another reader replies to the now-approved parent comment.
        replier_token = _register(client, email="replier@example.com").json()["access_token"]
        reply = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "a reply", "nickname": "R", "email": "r@example.com", "parent_id": parent_row.id},
            headers=_auth(replier_token),
        )
        assert reply.status_code == 201, reply.text
        reply_row = db_session.query(models.Comment).filter_by(content="a reply").first()
        assert reply_row is not None

        # Approve the reply (admin) -> parent reader gets a reply inbox row.
        ar = client.patch(f"/api/comments/{reply_row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ar.status_code == 200, ar.text

        data = client.get(NOTIFS, headers=headers).json()
        assert any(i["kind"] == "reply" for i in data["items"])

    def test_thread_comment_notification_persists(self, client, db_session, auth_headers):
        token = _token(client, email="thread@example.com")
        headers = _auth(token)
        post = _create_post(db_session)

        # reader follows the post's thread (comment subscription)
        sub = client.put(f"/api/posts/{post.id}/subscription", headers=headers)
        assert sub.status_code in (200, 201), sub.text

        # another reader comments; approve it (admin) -> thread followers notified
        other = _register(client, email="other@example.com").json()["access_token"]
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "new comment", "nickname": "O", "email": "o@example.com"},
            headers=_auth(other),
        )
        assert created.status_code == 201, created.text
        from app import models

        row = db_session.query(models.Comment).filter_by(content="new comment").first()
        assert row is not None
        ap = client.patch(f"/api/comments/{row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ap.status_code == 200, ap.text

        data = client.get(NOTIFS, headers=headers).json()
        assert any(i["kind"] == "thread_comment" for i in data["items"])

    def test_reapproving_an_approved_comment_does_not_re_fan_out(self, client, db_session, auth_headers):
        """Approval is idempotent: re-approving an already-approved comment
        (double click / retry) is a no-op and must not duplicate the
        thread-follower inbox row (round-296 deep-dive)."""
        token = _token(client, email="idem@example.com")
        headers = _auth(token)
        post = _create_post(db_session)

        # Reader follows the post's thread.
        sub = client.put(f"/api/posts/{post.id}/subscription", headers=headers)
        assert sub.status_code in (200, 201), sub.text

        other = _register(client, email="idem-other@example.com").json()["access_token"]
        created = client.post(
            f"/api/comments/post/{post.id}",
            json={"content": "idempotent comment", "nickname": "O", "email": "o@example.com"},
            headers=_auth(other),
        )
        assert created.status_code == 201, created.text
        from app import models

        row = db_session.query(models.Comment).filter_by(content="idempotent comment").first()
        assert row is not None

        # First approve fans out exactly one thread_comment row.
        ap = client.patch(f"/api/comments/{row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert ap.status_code == 200, ap.text
        first = client.get(NOTIFS, headers=headers).json()["items"]
        assert len([i for i in first if i["kind"] == "thread_comment"]) == 1

        # A re-approve of the already-approved comment must not add a second row
        # (before the fix the unguarded re-approve re-inserted the row).
        re = client.patch(f"/api/comments/{row.id}/approve", json={"approved": True}, headers=auth_headers)
        assert re.status_code == 200, re.text
        second = client.get(NOTIFS, headers=headers).json()["items"]
        assert len([i for i in second if i["kind"] == "thread_comment"]) == 1


class TestFanOutPrune:
    """Batch new-post fan-out prune (ISS-113, DEC-193, TASK-213).

    record_new_post_notifications used to run record_reader_notification's
    per-reader "SELECT recent-N + DELETE + commit" inside its follower loop —
    O(2n) queries per publish. It now bulk-inserts, flushes, prunes all touched
    readers with one set-based window-function delete, and commits once. These
    tests pin the cap semantics (newest MAX per reader survive) and that the
    fan-out still lands the new post's row while the inbox stays capped.
    """

    def test_batch_prune_keeps_newest_per_reader(self, db_session):
        from app import crud, models

        # Three readers overflowing the cap, one reader below it (untouched).
        for rid in (1, 2, 3):
            db_session.add_all(
                [
                    models.ReaderNotification(
                        reader_id=rid, kind="new_post", title=f"{rid}-{i}", body="b", url=f"/p/{i}"
                    )
                    for i in range(205)
                ]
            )
        db_session.add(models.ReaderNotification(reader_id=9, kind="reply", title="t", body="b", url="/x"))
        db_session.flush()

        crud._prune_notifications_for_readers(db_session, {1, 2, 3})
        db_session.commit()

        from sqlalchemy import func

        assert (
            db_session.query(func.count(models.ReaderNotification.id))
            .filter(models.ReaderNotification.reader_id.in_((1, 2, 3)))
            .scalar()
            == 600
        )
        assert (
            db_session.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == 1).count() == 200
        )
        # Newest rows (highest id) survive; the oldest are pruned.
        assert (
            db_session.query(models.ReaderNotification)
            .filter(models.ReaderNotification.reader_id == 1, models.ReaderNotification.title == "1-204")
            .one_or_none()
            is not None
        )
        assert (
            db_session.query(models.ReaderNotification)
            .filter(models.ReaderNotification.reader_id == 1, models.ReaderNotification.title == "1-0")
            .one_or_none()
            is None
        )
        # The reader below the cap is untouched by the batched prune.
        assert db_session.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == 9).count() == 1

    def test_fan_out_lands_new_post_and_stays_capped(self, client, db_session, auth_headers):
        from app import crud, models

        reg = _register(client, email="fan@example.com")
        reader_id = reg.json()["reader"]["id"]
        headers = _auth(reg.json()["access_token"])

        cat = client.post("/api/categories", json={"name": "FanOut"}, headers=auth_headers)
        cat_id = cat.json()["id"]
        follow = client.put(f"/api/reader/me/categories/{cat_id}/follow", headers=headers)
        assert follow.status_code in (200, 201), follow.text

        # Overfill the inbox, then publish: the fan-out must land the new-post
        # row while pruning back to the cap (205 old + 1 new -> 200).
        db_session.add_all(
            [
                models.ReaderNotification(
                    reader_id=reader_id, kind="new_post", title=f"old-{i}", body="b", url=f"/posts/old-{i}"
                )
                for i in range(205)
            ]
        )
        db_session.commit()

        post = client.post(
            "/api/posts",
            json={
                "title": "Capped post",
                "slug": "capped-notif-post",
                "content": "c",
                "published": True,
                "category_id": cat_id,
            },
            headers=auth_headers,
        )
        assert post.status_code == 201, post.text

        data = client.get(NOTIFS, headers=headers).json()
        assert data["total"] == 200  # cap enforced after the fan-out
        assert any(i["url"] == "/posts/capped-notif-post" for i in data["items"])
        assert crud.MAX_NOTIFICATIONS_PER_READER == 200  # keep the constant honest

    def test_record_thread_comment_notifications_batches_all_readers(self, db_session):
        """The batched thread-comment fan-out (ISS-427) persists a row for every
        target and prunes each reader's cap back in one pass — the batched
        counterpart of the per-follower record_reader_notification loop it
        replaced. One pre-existing reader below the cap stays untouched."""
        from app import crud, models

        # Reader 1 is over the cap (205 rows); reader 2 empty; reader 3 empty.
        db_session.add_all(
            [
                models.ReaderNotification(reader_id=1, kind="reply", title=f"old-{i}", body="b", url="/x")
                for i in range(205)
            ]
        )
        db_session.commit()

        crud.record_thread_comment_notifications(
            db_session,
            [1, 2, 3],
            post_title="T",
            url="/posts/t#comment-9",
        )

        from sqlalchemy import func

        # All three get exactly one new thread_comment row.
        rows = (
            db_session.query(models.ReaderNotification).filter(models.ReaderNotification.kind == "thread_comment").all()
        )
        assert sorted(r.reader_id for r in rows) == [1, 2, 3]
        # Reader 1's cap was pruned back to 200 (205 old + 1 new -> 200 kept).
        count_1 = (
            db_session.query(func.count(models.ReaderNotification.id))
            .filter(models.ReaderNotification.reader_id == 1)
            .scalar()
        )
        assert count_1 == 200


class TestMentionNotifications:
    """@-mention fan-out (DEC-322, TASK-389).

    When an APPROVED comment contains a reader's exact display name as
    ``@<name>``, that reader gets a durable ``kind=mention`` inbox row
    deep-linking to the comment — never the commenter themselves, never a
    deactivated reader, and never someone who switched the 'mention' pref off
    (DEC-171). Resolution is boundary-exact: ``@Ri`` inside ``@Riki`` must not
    notify reader "Ri". Mentions fire at approval (moderation gate), so a
    comment still pending notifies nobody.
    """

    def _register_named(self, client, email, display_name):
        resp = client.post(
            "/api/reader/register",
            json={"email": email, "password": "rpass123", "display_name": display_name},
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        return body["access_token"], body["reader"]["id"]

    def _comment(self, client, post_id, content, token=None):
        # The CommentCreate schema requires nickname/email; a reader-attributed
        # comment still sends them (they are stamped/ignored server-side).
        body = {"content": content, "nickname": "Mentioner", "email": "mentioner@example.com"}
        resp = client.post(f"/api/comments/post/{post_id}", json=body, headers=_auth(token) if token else None)
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def _approve(self, client, auth_headers, comment_id):
        resp = client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
        assert resp.status_code == 200, resp.text

    def test_approval_mention_persists_a_kind_mention_row_with_comment_deep_link(
        self, client, db_session, auth_headers
    ):
        named_token, _ = self._register_named(client, "mentioned@example.com", "Riki")
        author_token = _token(client, email="author@example.com")
        post = _create_post(db_session)
        comment_id = self._comment(client, post.id, "Hey @Riki, what do you think?", token=author_token)
        self._approve(client, auth_headers, comment_id)

        inbox = client.get(NOTIFS, headers=_auth(named_token)).json()
        assert inbox["total"] == 1, inbox
        item = inbox["items"][0]
        assert item["kind"] == "mention"
        assert item["url"] == f"/posts/{post.slug}#comment-{comment_id}"

    def test_pending_mention_notifies_nobody(self, client, db_session):
        named_token, _ = self._register_named(client, "pending-target@example.com", "Riki")
        author_token = _token(client, email="pauthor@example.com")
        post = _create_post(db_session)
        self._comment(client, post.id, "Hey @Riki", token=author_token)
        # Never approved -> the mention must not fire (moderation gate).
        target = client.get(NOTIFS, headers=_auth(named_token)).json()
        assert target["total"] == 0

    def test_commenter_self_mention_is_skipped(self, client, db_session, auth_headers):
        author_token, author_id = self._register_named(client, "selfer@example.com", "RikiSelf")
        post = _create_post(db_session)
        comment_id = self._comment(client, post.id, "Great point @RikiSelf", token=author_token)
        self._approve(client, auth_headers, comment_id)

        from app import models

        rows = (
            db_session.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == author_id).all()
        )
        assert rows == []

    def test_mention_respects_the_disabled_pref(self, client, db_session, auth_headers):
        named_token, named_id = self._register_named(client, "opted-out@example.com", "RikiOut")
        # Turn the mention kind off; the fan-out must drop this reader entirely.
        off = client.patch(PREFS, json={"kind": "mention", "enabled": False}, headers=_auth(named_token))
        assert off.status_code == 200, off.text
        assert off.json()["mention"] is False

        author_token = _token(client, email="m-author@example.com")
        post = _create_post(db_session)
        comment_id = self._comment(client, post.id, "cc @RikiOut", token=author_token)
        self._approve(client, auth_headers, comment_id)

        from app import models

        rows = db_session.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == named_id).all()
        assert rows == []

    def test_mention_skips_a_deactivated_reader(self, client, db_session, auth_headers):
        _, named_id = self._register_named(client, "offline@example.com", "RikiOff")
        from app import auth as auth_mod
        from app import models as m

        reader = db_session.get(auth_mod.ReaderAccount, named_id)
        reader.is_active = False
        db_session.commit()

        author_token = _token(client, email="m-off@example.com")
        post = _create_post(db_session)
        comment_id = self._comment(client, post.id, "ping @RikiOff", token=author_token)
        self._approve(client, auth_headers, comment_id)

        rows = db_session.query(m.ReaderNotification).filter(m.ReaderNotification.reader_id == named_id).all()
        assert rows == []

    def test_mention_boundary_does_not_partial_match_shorter_names(self, client, db_session, auth_headers):
        # "Ri" must NOT be notified by "@Riki..." — resolution is boundary-exact
        # (a naive `"@Ri" in content` substring would misfire on the longer name).
        ri_token, ri_id = self._register_named(client, "ri@example.com", "Ri")
        self._register_named(client, "riki@example.com", "Riki")

        author_token = _token(client, email="boundary@example.com")
        post = _create_post(db_session)
        comment_id = self._comment(client, post.id, "Please @Riki decide this", token=author_token)
        self._approve(client, auth_headers, comment_id)

        from app import models

        ri_rows = db_session.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == ri_id).all()
        assert ri_rows == []

    def test_mention_ignores_unknown_display_names(self, client, db_session, auth_headers):
        known_token, _ = self._register_named(client, "onlyme@example.com", "Riki")
        author_token = _token(client, email="unknown@example.com")
        post = _create_post(db_session)
        comment_id = self._comment(client, post.id, "@NobodyReal check this", token=author_token)
        self._approve(client, auth_headers, comment_id)

        inbox = client.get(NOTIFS, headers=_auth(known_token)).json()
        assert inbox["total"] == 0

    def test_mention_pref_surface_exposes_the_kind(self, client):
        token = _token(client, email="pref-view@example.com")
        prefs = client.get(PREFS, headers=_auth(token)).json()
        assert prefs["mention"] is True

    def test_resolve_mention_fast_paths_without_at(self, db_session):
        """A comment with no '@' must skip resolution entirely (no reader scan)."""
        from app import crud

        assert crud.resolve_mention_reader_ids(db_session, "plain text, no mentions") == []
        assert crud.resolve_mention_reader_ids(db_session, "") == []
