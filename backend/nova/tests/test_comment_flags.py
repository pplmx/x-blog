"""Comment flagging tests (DEC-108, TASK-166).

Readers can flag a comment for moderation; one flag per (comment, source) is
enforced (idempotent, no click spam), and the admin list can filter to flagged
comments, show their distinct-flag count, and dismiss the flags.
"""

from app.crud import create_post, flag_comment
from app.schemas import PostCreate


async def _post(db_session, slug="flag-post"):
    return await create_post(
        db_session,
        PostCreate(title="Flag Post", slug=slug, content="# Hi", published=True),
    )


async def _comment(client, post_id, content="flagged content"):
    resp = await client.post(
        f"/api/comments/post/{post_id}",
        json={"nickname": "C", "email": "c@example.com", "content": content},
    )
    assert resp.status_code == 201
    return resp.json()


class TestFlagEndpoint:
    async def test_flag_comment_new(self, client, db_session):
        post = await _post(db_session)
        c = await _comment(client, post.id)
        resp = await client.post(f"/api/comments/{c['id']}/flag")
        assert resp.status_code == 201, resp.text
        assert resp.json() == {"comment_id": c["id"], "flags": 1, "is_new": True}

    async def test_flag_again_is_idempotent(self, client, db_session):
        post = await _post(db_session)
        c = await _comment(client, post.id)
        assert (await client.post(f"/api/comments/{c['id']}/flag")).status_code == 201
        again = await client.post(f"/api/comments/{c['id']}/flag")
        assert again.status_code == 200
        assert again.json()["flags"] == 1
        assert again.json()["is_new"] is False

    async def test_flag_unknown_comment_404(self, client):
        assert (await client.post("/api/comments/999999/flag")).status_code == 404

    async def test_flag_comment_on_non_public_post_404(self, client, db_session):
        from app import models

        draft = await create_post(db_session, PostCreate(title="D", slug="flag-draft", content="# D", published=False))
        comment = models.Comment(
            post_id=draft.id,
            nickname="X",
            email="x@x.com",
            content="hidden",
            is_approved=False,
        )
        db_session.add(comment)
        await db_session.flush()
        assert (await client.post(f"/api/comments/{comment.id}/flag")).status_code == 404


class TestCrudDedup:
    async def test_distinct_sources_count_separately(self, db_session):
        post = await _post(db_session, slug="flag-dedup")
        from app import models

        comment = models.Comment(post_id=post.id, nickname="N", email="n@x", content="x", is_approved=False)
        db_session.add(comment)
        await db_session.flush()

        created1, total1 = await flag_comment(db_session, comment.id, "ip-A")
        created2, total2 = await flag_comment(db_session, comment.id, "ip-A")
        created3, total3 = await flag_comment(db_session, comment.id, "ip-B")

        assert (created1, total1) == (True, 1)
        assert (created2, total2) == (False, 1)  # same source -> idempotent
        assert (created3, total3) == (True, 2)  # distinct source -> counted


class TestAdminFlagged:
    async def _flagged_comment(self, client, db_session, slug):
        post = await _post(db_session, slug=slug)
        c = await _comment(client, post.id, content=f"{slug} body")
        await flag_comment(db_session, c["id"], "ip-X")
        return post, c["id"]

    async def test_admin_list_flagged(self, client, db_session, auth_headers):
        post_f, cid_f = await self._flagged_comment(client, db_session, "flag-f")
        post_c, cid_c = await self._comment_and_no_flag(client, db_session, "flag-c")

        flagged = (await client.get("/api/admin/comments", params={"flagged": True}, headers=auth_headers)).json()
        item = next((i for i in flagged["items"] if i["id"] == cid_f), None)
        assert item is not None
        assert item["flag_count"] == 1
        assert all(i["id"] != cid_c for i in flagged["items"])

        unflagged = (await client.get("/api/admin/comments", params={"flagged": False}, headers=auth_headers)).json()
        assert any(i["id"] == cid_c for i in unflagged["items"])
        assert not any(i["id"] == cid_f for i in unflagged["items"])

    async def _comment_and_no_flag(self, client, db_session, slug):
        post = await _post(db_session, slug=slug)
        c = await _comment(client, post.id, content=f"{slug} body")
        return post, c["id"]

    async def test_dismiss_flags(self, client, db_session, auth_headers):
        post, cid = await self._flagged_comment(client, db_session, "flag-dismiss")
        resp = await client.delete(f"/api/admin/comments/{cid}/flags", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == {"comment_id": cid, "removed": 1}

        listed = (await client.get("/api/admin/comments", params={"flagged": True}, headers=auth_headers)).json()
        assert not any(i["id"] == cid for i in listed["items"])


class TestBulkDelete:
    async def _approved_comment(self, client, db_session, post_id, content):
        from app.crud import approve_comment

        c = await _comment(client, post_id, content=content)
        await approve_comment(db_session, c["id"], approved=True)
        return c

    async def _reply(self, client, db_session, post_id, parent_id, content):
        from app.crud import approve_comment

        r = await client.post(
            f"/api/comments/post/{post_id}",
            json={"nickname": "R", "email": "r@example.com", "content": content, "parent_id": parent_id},
        )
        assert r.status_code == 201
        rid = r.json()["id"]
        await approve_comment(db_session, rid, approved=True)
        return rid

    async def test_bulk_delete_removes_selected(self, client, db_session, auth_headers):
        post = await _post(db_session, slug="bulk-1")
        c1 = await self._approved_comment(client, db_session, post.id, "one")
        c2 = await self._approved_comment(client, db_session, post.id, "two")

        resp = await client.post(
            "/api/admin/comments/batch-delete", json={"ids": [c1["id"], c2["id"]]}, headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2

        left = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        assert all(c["id"] not in (c1["id"], c2["id"]) for c in left)

    async def test_bulk_delete_reparents_surviving_reply(self, client, db_session, auth_headers):
        post = await _post(db_session, slug="bulk-reparent")
        top = await self._approved_comment(client, db_session, post.id, "top")
        reply = await self._reply(client, db_session, post.id, top["id"], "a reply")

        resp = await client.post("/api/admin/comments/batch-delete", json={"ids": [top["id"]]}, headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 1

        left = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        moved = next((c for c in left if c["id"] == reply), None)
        assert moved is not None
        assert moved["parent_id"] is None  # promoted to top-level

    async def test_bulk_delete_deleting_parent_and_reply_leaves_orphan_free(self, client, db_session, auth_headers):
        post = await _post(db_session, slug="bulk-orphan")
        top = await self._approved_comment(client, db_session, post.id, "top")
        reply = await self._reply(client, db_session, post.id, top["id"], "a reply")

        resp = await client.post(
            "/api/admin/comments/batch-delete",
            json={"ids": [top["id"], reply]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2
        left = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        assert all(c["id"] not in (top["id"], reply) for c in left)

    async def test_bulk_delete_requires_admin(self, client, db_session):
        post = await _post(db_session, slug="bulk-auth")
        c = await _comment(client, post.id)
        resp = await client.post("/api/admin/comments/batch-delete", json={"ids": [c["id"]]})
        assert resp.status_code == 401

    async def test_bulk_delete_is_batched_not_n_plus_one(self, client, db_session, auth_headers, test_engine):
        """Deleting a deep thread must not run one query per deleted id.

        ISS-557: the old loop issued a reply-query per comment plus a db.get
        per ancestor while walking the chain. The batch rewrite answers the
        thread with one parent_id IN (...) query and an in-memory parent map.
        (The reparent behavior itself is locked in by the sibling tests;
        this one pins the query COUNT.)
        """
        post = await _post(db_session, slug="bulk-count")
        # Nine-deep thread: top -> c1 -> ... -> c8, plus one surviving reply.
        top = await self._approved_comment(client, db_session, post.id, "top")
        parent = top["id"]
        ids = [top["id"]]
        for i in range(8):
            cid = await self._reply(client, db_session, post.id, parent, f"level-{i}")
            parent = cid
            ids.append(cid)
        survivor = await self._reply(client, db_session, post.id, parent, "survivor")

        # Delete all nine (leaving `survivor` to be promoted to top-level).
        statements: list[str] = []
        from sqlalchemy import event as _event

        def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
            body = str(statement)
            if body.lstrip().upper().startswith("SELECT") and "FROM comments" in body:
                statements.append(body)

        _event.listen(test_engine.sync_engine, "before_cursor_execute", capture)
        try:
            resp = await client.post(
                "/api/admin/comments/batch-delete",
                json={"ids": ids},
                headers=auth_headers,
            )
        finally:
            _event.remove(test_engine.sync_engine, "before_cursor_execute", capture)

        assert resp.status_code == 200
        assert resp.json()["deleted"] == len(ids)
        # The survivor still exists, promoted to top-level (reparent intact).
        left = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        moved = next((c for c in left if c["id"] == survivor), None)
        assert moved is not None
        assert moved["parent_id"] is None
        # One comments-SELECT loads the delete set, one answers the survivors —
        # a constant, NOT one per id (which would be 9+ here).
        assert len(statements) <= 3, f"expected O(1) comments SELECTs, got {len(statements)}"
