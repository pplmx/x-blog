"""Reader-blocking contract + notification-suppression tests (DEC-425, TASK-437).

A signed-in reader can block ANOTHER reader so that commenter's personal
fan-out stops landing: @-mentions, replies, thread-comment broadcast and
reader-follow-activity rows are each suppressed at their dispatch point when
the target reader has a ``reader_blocks`` row hiding the commenter. The block
is one-way and invisible (the blocked reader is never told and can keep
posting) — it is an opt-out on the *receiver's* side, not a content filter.

Key properties:
- GET/PUT/DELETE /api/reader/me/blocks{,/{id}} require a reader token (401
  anonymous, 401 for an admin token — reader-scoped surface);
- block is idempotent (201 on first, 200 after), self-block is 400, an
  unknown/deactivated target is a uniform 404 (no "can I block this email"
  oracle);
- GET lists blocked readers with their public identity + blocked_at, newest
  first, dropping deactivated accounts;
- DELETE is an idempotent 204;
- blocking suppresses the blocked commenter's mention / reply /
  thread-comment / follow-activity notifications to the blocker (each fan-out
  drops a blocker-of-the-commenter before writing rows), and unblocking
  restores them.
"""

from uuid import uuid4

from sqlalchemy import select

from app.schemas import PostCreate

BLOCKS = "/api/reader/me/blocks"


async def _create_post(db_session, slug=None):
    from app.crud import create_post

    return await create_post(
        db_session,
        PostCreate(
            title="A post",
            slug=slug or f"block-{uuid4().hex[:8]}",
            content="# Hi",
            published=True,
        ),
    )


async def _register(client, email, display_name=None):
    resp = await client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": display_name},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


async def _token(client, email="reader@example.com", display_name=None):
    return await _register(client, email, display_name)


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _rid(db_session, email):
    from app.auth import ReaderAccount

    return (await db_session.execute(select(ReaderAccount).where(ReaderAccount.email == email))).scalar_one().id


async def _comment(client, post_id, content, token=None, nickname="B", email=None, parent_id=None):
    body = {"content": content, "nickname": nickname, "email": email or f"{nickname}@example.com"}
    if parent_id is not None:
        body["parent_id"] = parent_id
    return await client.post(
        f"/api/comments/post/{post_id}",
        json=body,
        headers=(_auth(token) if token else {}),
    )


async def _approve(client, auth_headers, comment_id, approved=True):
    resp = await client.patch(f"/api/comments/{comment_id}/approve", json={"approved": approved}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


async def _inbox_kinds(client, token):
    data = (await client.get("/api/reader/me/notifications", headers=_auth(token))).json()
    return {item["kind"] for item in data.get("items", [])}


class TestAuthRequired:
    async def test_block_requires_reader_token(self, client):
        assert (await client.put(f"{BLOCKS}/1")).status_code == 401
        assert (await client.get(BLOCKS)).status_code == 401
        assert (await client.delete(f"{BLOCKS}/1")).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        assert (await client.put(f"{BLOCKS}/1", headers=headers)).status_code == 401
        assert (await client.get(BLOCKS, headers=headers)).status_code == 401
        assert (await client.delete(f"{BLOCKS}/1", headers=headers)).status_code == 401


class TestBlockContract:
    async def test_self_block_rejected(self, client, db_session):
        token = await _token(client, email="self@example.com")
        rid = await _rid(db_session, "self@example.com")
        resp = await client.put(f"{BLOCKS}/{rid}", headers=_auth(token))
        assert resp.status_code == 400

    async def test_unknown_reader_is_uniform_404(self, client):
        token = await _token(client, email="unknown@example.com")
        assert (await client.put(f"{BLOCKS}/999999", headers=_auth(token))).status_code == 404

    async def test_deactivated_target_is_404(self, client, db_session):
        token = await _token(client, email="act@example.com")
        from app.auth import ReaderAccount

        target = ReaderAccount(email="gone@example.com", password="x", display_name="Gone", is_active=False)
        db_session.add(target)
        await db_session.flush()
        assert (await client.put(f"{BLOCKS}/{target.id}", headers=_auth(token))).status_code == 404

    async def test_block_is_idempotent(self, client, db_session):
        token = await _token(client, email="blocker@example.com")
        await _token(client, email="victim@example.com", display_name="Victim")
        rid = await _rid(db_session, "victim@example.com")
        assert (await client.put(f"{BLOCKS}/{rid}", headers=_auth(token))).status_code == 201
        assert (await client.put(f"{BLOCKS}/{rid}", headers=_auth(token))).status_code == 200
        assert (await client.put(f"{BLOCKS}/{rid}", headers=_auth(token))).status_code == 200

    async def test_block_returns_public_identity(self, client, db_session):
        blocker = await _token(client, email="blocker2@example.com")
        await _token(client, email="victim2@example.com", display_name="Demo")
        rid = await _rid(db_session, "victim2@example.com")
        body = (await client.put(f"{BLOCKS}/{rid}", headers=_auth(blocker))).json()
        assert body["reader_id"] == rid
        assert body["display_name"] == "Demo"
        assert body["blocked_at"]

    async def test_list_is_empty_initially(self, client, db_session):
        token = await _token(client, email="empty@example.com")
        assert (await client.get(BLOCKS, headers=_auth(token))).json() == {"items": [], "total": 0}

    async def test_list_roundtrip_newest_first_with_identity(self, client, db_session):
        token = await _token(client, email="lister@example.com")
        # Block two readers; re-blocking the first keeps a single row, so the
        # relation is per (blocker, blocked) pair, not an event log.
        await _token(client, email="first@example.com", display_name="First")
        await _token(client, email="second@example.com", display_name="Second")
        rid1 = await _rid(db_session, "first@example.com")
        rid2 = await _rid(db_session, "second@example.com")
        await client.put(f"{BLOCKS}/{rid1}", headers=_auth(token))
        await client.put(f"{BLOCKS}/{rid2}", headers=_auth(token))
        data = (await client.get(BLOCKS, headers=_auth(token))).json()
        assert data["total"] == 2
        ids = [item["reader_id"] for item in data["items"]]
        assert ids == [rid2, rid1]  # newest first
        assert {item["display_name"] for item in data["items"]} == {"First", "Second"}

    async def test_list_drops_deactivated_blocked_reader(self, client, db_session):
        token = await _token(client, email="drops@example.com")
        await _token(client, email="ghost@example.com", display_name="Ghost")
        rid = await _rid(db_session, "ghost@example.com")
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(token))
        from app.auth import ReaderAccount

        ghost = (
            await db_session.execute(select(ReaderAccount).where(ReaderAccount.email == "ghost@example.com"))
        ).scalar_one()
        ghost.is_active = False
        await db_session.commit()
        data = (await client.get(BLOCKS, headers=_auth(token))).json()
        assert data == {"items": [], "total": 0}

    async def test_unblock_is_idempotent_and_takes_effect(self, client, db_session):
        token = await _token(client, email="unblock@example.com")
        await _token(client, email="togo@example.com", display_name="Togo")
        rid = await _rid(db_session, "togo@example.com")
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(token))
        assert (await client.delete(f"{BLOCKS}/{rid}", headers=_auth(token))).status_code == 204
        assert (await client.get(BLOCKS, headers=_auth(token))).json() == {"items": [], "total": 0}
        assert (await client.delete(f"{BLOCKS}/{rid}", headers=_auth(token))).status_code == 204

    async def test_block_is_invisible_and_one_way(self, client, db_session, auth_headers):
        """The blocked reader is never told and can keep commenting."""
        post = await _create_post(db_session)
        blocker = await _token(client, email="ow@example.com")
        blocked = await _token(client, email="bl@example.com", display_name="Blocked")
        rid = await _rid(db_session, "bl@example.com")
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(blocker))
        # The blocked reader's own block list is empty (one-way).
        assert (await client.get(BLOCKS, headers=_auth(blocked))).json() == {"items": [], "total": 0}
        # And they can still comment after being blocked.
        created = await _comment(client, post.id, "still here", token=blocked, nickname="B", email="bl@example.com")
        assert created.status_code == 201


class TestNotificationSuppression:
    async def _blocked_pair(self, client, db_session, name="Blocked", blocker_email="supp@example.com"):
        blocker = await _token(client, email=blocker_email, display_name="Blocker")
        blocked_email = f"b-{uuid4().hex[:6]}@example.com"
        blocked = await _token(client, email=blocked_email, display_name=name)
        rid = await _rid(db_session, blocked_email)
        return blocker, blocked, rid

    async def test_block_suppresses_mention(self, client, db_session, auth_headers):
        post = await _create_post(db_session)
        blocker, blocked, rid = await self._blocked_pair(client, db_session)
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(blocker))
        # The blocked reader @-mentions the blocker; approving must NOT notify.
        created = await _comment(client, post.id, "Hey @Blocker!", token=blocked, nickname="B")
        await _approve(client, auth_headers, created.json()["id"])
        assert "mention" not in await _inbox_kinds(client, blocker)

    async def test_mention_lands_without_block(self, client, db_session, auth_headers):
        """Control: the same mention DOES reach an unblocked reader."""
        post = await _create_post(db_session)
        blocker = await _token(client, email="ctrl-mention@example.com", display_name="Control")
        mancer = await _token(client, email="ctrl-mancer@example.com", display_name="Mancer")
        created = await _comment(client, post.id, "@Control!", token=mancer, nickname="M")
        await _approve(client, auth_headers, created.json()["id"])
        assert "mention" in await _inbox_kinds(client, blocker)

    async def test_block_suppresses_reply(self, client, db_session, auth_headers):
        post = await _create_post(db_session)
        blocker, blocked, rid = await self._blocked_pair(client, db_session, blocker_email="supp-reply@example.com")
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(blocker))
        parent = await _comment(client, post.id, "parent reply target", token=blocker, nickname="P")
        await _approve(client, auth_headers, parent.json()["id"])
        reply = await _comment(client, post.id, "a reply", token=blocked, nickname="B", parent_id=parent.json()["id"])
        await _approve(client, auth_headers, reply.json()["id"])
        assert "reply" not in await _inbox_kinds(client, blocker)

    async def test_block_suppresses_thread_comment(self, client, db_session, auth_headers):
        post = await _create_post(db_session)
        blocker, blocked, rid = await self._blocked_pair(client, db_session, blocker_email="supp-thread@example.com")
        sub = await client.put(f"/api/posts/{post.id}/subscription", headers=_auth(blocker))
        assert sub.status_code in (200, 201), sub.text
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(blocker))
        created = await _comment(client, post.id, "thread chatter", token=blocked, nickname="B")
        await _approve(client, auth_headers, created.json()["id"])
        assert "thread_comment" not in await _inbox_kinds(client, blocker)

    async def test_block_suppresses_follow_activity(self, client, db_session, auth_headers):
        post = await _create_post(db_session)
        blocker, blocked, rid = await self._blocked_pair(client, db_session, blocker_email="supp-follow@example.com")
        # Blocker follows the other reader (reader_comment fan-out), then blocks.
        assert (await client.put(f"/api/reader/me/follows/readers/{rid}", headers=_auth(blocker))).status_code in (
            200,
            201,
        )
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(blocker))
        created = await _comment(client, post.id, "a followed comment", token=blocked, nickname="B")
        await _approve(client, auth_headers, created.json()["id"])
        assert "reader_comment" not in await _inbox_kinds(client, blocker)

    async def test_unblock_restores_reply_notifications(self, client, db_session, auth_headers):
        """After unblocking, the same fan-out lands again."""
        post = await _create_post(db_session)
        blocker, blocked, rid = await self._blocked_pair(client, db_session, blocker_email="supp-restore@example.com")
        await client.put(f"{BLOCKS}/{rid}", headers=_auth(blocker))
        parent = await _comment(client, post.id, "parent", token=blocker, nickname="P")
        await _approve(client, auth_headers, parent.json()["id"])
        reply = await _comment(
            client, post.id, "pre-unblock reply", token=blocked, nickname="B", parent_id=parent.json()["id"]
        )
        await _approve(client, auth_headers, reply.json()["id"])
        assert "reply" not in await _inbox_kinds(client, blocker)
        # Unblock, then a second reply lands in the inbox.
        assert (await client.delete(f"{BLOCKS}/{rid}", headers=_auth(blocker))).status_code == 204
        reply2 = await _comment(
            client, post.id, "post-unblock reply", token=blocked, nickname="B", parent_id=parent.json()["id"]
        )
        await _approve(client, auth_headers, reply2.json()["id"])
        assert "reply" in await _inbox_kinds(client, blocker)
