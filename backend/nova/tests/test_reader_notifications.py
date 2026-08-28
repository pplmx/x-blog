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
        token = _token(client, email="list@example.com")
        headers = _auth(token)
        from app import models

        first = models.ReaderNotification(reader_id=1, kind="reply", title="t1", body="b1", url="/posts/x#c1")
        second = models.ReaderNotification(reader_id=1, kind="new_post", title="t2", body="b2", url="/posts/y")
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
        token = _token(client, email="unread@example.com")
        headers = _auth(token)
        from datetime import datetime

        from app import models

        db_session.add(models.ReaderNotification(reader_id=1, kind="reply", title="unread1"))
        db_session.add(
            models.ReaderNotification(reader_id=1, kind="reply", title="read1", read_at=datetime(2026, 1, 1))
        )
        db_session.commit()

        resp = client.get(NOTIFS, params={"unread": "true"}, headers=headers)
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["title"] == "unread1"
        assert data["unread"] == 1

    def test_read_all(self, client, db_session):
        token = _token(client, email="all@example.com")
        headers = _auth(token)
        from app import models

        db_session.add(models.ReaderNotification(reader_id=1, kind="reply", title="a"))
        db_session.add(models.ReaderNotification(reader_id=1, kind="reply", title="b"))
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


class TestPersistenceHooks:
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
