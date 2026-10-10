"""Reader-attributed comments contract tests (DEC-062, TASK-135).

Reader accounts give commenters a verified identity: a signed-in reader's
comment is stamped with their account (client-supplied nickname/email is
ignored — a reader cannot spoof another reader's display name), and the reader
can list their own comment history. Anonymous comments still work unchanged
with free-text nickname/email.

Critical properties:
- a signed-in reader's comment serializes their account identity (display_name,
  not the nickname they typed, and email never echoed publicly);
- identity always comes from the JWT, never from client input;
- /api/reader/me/comments lists the caller's own comments across statuses
  (pending / approved / rejected) with a per-item `status`, isolated per reader;
- a reader can DELETE their own comment (any status); others' comments 404.
"""

from datetime import datetime

from sqlalchemy import select, update


async def _create_post(db_session, slug="reader-comment-post"):
    from app.crud import create_post
    from app.schemas import PostCreate

    return await create_post(
        db_session,
        PostCreate(title="Reader comment post", slug=slug, content="# Hello", published=True),
    )


async def _register(client, email="commenter@example.com", display_name="Reading Reader"):
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": display_name},
    )


async def _token(client, **kw):
    return (await _register(client, **kw)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _post_comment(client, post_id, body=None, headers=None, **headers_kw):
    payload = body or {"nickname": "x", "email": "x@x.com", "content": "hello"}
    return await client.post(f"/api/comments/post/{post_id}", json=payload, headers=headers or headers_kw)


class TestSignedInIdentity:
    async def test_signed_in_comment_uses_account_display_name(self, client, db_session):
        post = await _create_post(db_session)
        token = await _token(client, display_name="Riki")
        # Client sends a forged nickname/email — must be ignored for readers.
        resp = await _post_comment(
            client,
            post.id,
            {"nickname": "Not Riki", "email": "forged@example.com", "content": "Nice post!"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["nickname"] == "Riki"
        reader = data.get("reader")
        assert reader is not None
        # Dialect-safe account id check: SQLite (re)uses id 1 after a rollback
        # but PostgreSQL advances sequences even when the insert rolls back, so
        # an absolute id assertion only holds for the first registration. The
        # identity contract is the stamped display_name, not the id number.
        assert isinstance(reader["id"], int) and reader["id"] > 0
        assert reader["display_name"] == "Riki"
        # The account email is PII and must never ride a public comment —
        # neither the forged client email nor the stored account email.
        assert "forged@example.com" not in resp.text
        assert "commenter@example.com" not in resp.text
        assert "email" not in reader

    async def test_identity_comes_from_jwt_not_client(self, client, db_session):
        """A spoofed display_name is ignored; identity is the account's."""
        post = await _create_post(db_session)
        token = await _token(client, email="clara@example.com", display_name="Clara")
        resp = await _post_comment(
            client,
            post.id,
            {"nickname": "Clara", "email": "impostor@example.com", "content": "hi"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["reader"]["display_name"] == "Clara"
        # See test_signed_in_comment_uses_account_display_name: no absolute id
        # assertion — PG sequences advance on rolled-back inserts (SQLite reuses
        # ids), so a later registration in the process has a nonzero id > 1.
        assert isinstance(resp.json()["reader"]["id"], int) and resp.json()["reader"]["id"] > 0
        assert "impostor@example.com" not in resp.text

    async def test_anonymous_comment_unaffected(self, client, db_session):
        post = await _create_post(db_session)
        resp = await _post_comment(client, post.id, {"nickname": "Guest", "email": "g@example.com", "content": "hi"})
        assert resp.status_code == 201, resp.text
        assert resp.json()["nickname"] == "Guest"
        assert resp.json().get("reader") is None

    async def test_reader_without_display_name_never_uses_email_as_nickname(self, client, db_session):
        """A reader registered with only {email, password} (display_name is
        optional) must not get their account email published as the public
        comment nickname — the email column is already suppressed for
        reader-attributed comments, so this must not reappear through the
        nickname fallback (audit finding, ISS-606/TASK-532).

        The nickname must be a generated non-PII handle instead, and the
        account email must never ride the response body.
        """
        post = await _create_post(db_session)
        email = "no-display@example.com"
        token = await _token(client, email=email, display_name=None)
        resp = await _post_comment(
            client,
            post.id,
            {"nickname": "Whatever", "email": "ignored@example.com", "content": "hi"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        # The account email (nor the forged client one) must not leak anywhere.
        assert email.lower() not in resp.text
        assert "ignored@example.com" not in resp.text
        # A non-empty public handle exists and is not an email address.
        assert data["nickname"]
        assert "@" not in data["nickname"]
        assert data.get("reader") is not None


class TestCommentHistory:
    async def test_list_own_approved_comment(self, client, db_session):
        from app.crud import approve_comment

        post = await _create_post(db_session)
        token = await _token(client)
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        await approve_comment(db_session, created["id"], approved=True)

        resp = await client.get("/api/reader/me/comments", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == created["id"]
        assert body["items"][0]["post_id"] == post.id
        assert body["items"][0]["status"] == "approved"

    async def test_pending_comments_shown_as_pending(self, client, db_session):
        """A pending comment is the author's own content — show it with a
        pending status (moderated-blog visibility: the author knows it is in
        review). (DEC-066 flips the DEC-062 approved-only read path)."""
        post = await _create_post(db_session)
        token = await _token(client)
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        resp = await client.get("/api/reader/me/comments", headers=_auth(token))
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == created["id"]
        assert body["items"][0]["status"] == "pending"

    async def test_rejected_comment_shows_rejected_status(self, client, db_session):
        from app.crud import approve_comment

        post = await _create_post(db_session)
        token = await _token(client)
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        await approve_comment(db_session, created["id"], approved=False)

        body = (await client.get("/api/reader/me/comments", headers=_auth(token))).json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == created["id"]
        assert body["items"][0]["status"] == "rejected"

    async def test_isolated_per_reader(self, client, db_session):
        from app.crud import approve_comment

        post = await _create_post(db_session)
        t1 = await _token(client, email="a1@example.com", display_name="A")
        t2 = await _token(client, email="a2@example.com", display_name="B")
        own = (await _post_comment(client, post.id, headers=_auth(t1))).json()
        await approve_comment(db_session, own["id"], approved=True)
        assert (await client.get("/api/reader/me/comments", headers=_auth(t1))).json()["total"] == 1
        assert (await client.get("/api/reader/me/comments", headers=_auth(t2))).json()["total"] == 0

    async def test_requires_reader_token(self, client):
        resp = await client.get("/api/reader/me/comments")
        assert resp.status_code == 401

    async def test_history_pagination_stable_with_tied_timestamps(self, client, db_session):
        """The reader's own history must not repeat/skip across pages when
        several comments share one created_at — crud appends an id tiebreak to
        the newest-first ordering (round 278, same class as the public list).
        """
        from app import models

        post = await _create_post(db_session)
        token = await _token(client)
        for _ in range(7):
            await _post_comment(client, post.id, headers=_auth(token))

        stamp = datetime(2024, 5, 1, 12, 0, 0)
        (await db_session.execute(update(models.Comment).values({models.Comment.created_at: stamp})))
        await db_session.commit()
        comment_ids = (await db_session.execute(select(models.Comment.id).order_by(models.Comment.id))).scalars().all()
        assert len(comment_ids) == 7

        seen: list[int] = []
        page = 1
        for _ in range(10):
            body = (
                await client.get(
                    "/api/reader/me/comments",
                    params={"page": page, "limit": 3},
                    headers=_auth(token),
                )
            ).json()
            seen.extend(c["id"] for c in body["items"])
            if page >= body["total_pages"]:
                break
            page += 1
        # Newest-first history: with all timestamps tied, id desc is the
        # deterministic order — the full page set must be exactly that.
        assert seen == list(reversed(comment_ids)), f"expected {list(reversed(comment_ids))}, got {seen}"

    async def test_post_subscriptions_pagination_stable_with_tied_timestamps(self, client, db_session):
        """/me/post-subscriptions newest-first paging must not repeat/skip
        threads when follows tie on created_at — crud appends the subscription
        id tiebreak (round 278, same class as the comment lists).
        """
        from app import models
        from app.auth import ReaderAccount
        from app.crud import list_reader_comment_subscriptions

        await _token(client)  # registers the reader
        reader = (
            await db_session.execute(select(ReaderAccount).order_by(ReaderAccount.id.desc()))
        ).scalar_one_or_none()
        posts = [await _create_post(db_session, slug=f"tie-sub-{i}") for i in range(6)]
        stamp = datetime(2024, 5, 1, 12, 0, 0)
        for p in posts:
            db_session.add(models.CommentSubscription(reader_id=reader.id, post_id=p.id, created_at=stamp))
        await db_session.commit()

        rows, total = await list_reader_comment_subscriptions(db_session, reader.id, page=1, limit=4)
        assert total == 6
        ids = [r.id for r in rows]
        # Newest follow first; with all timestamps tied the id desc tiebreak is
        # deterministic — first page must be the 4 most-recent subscriber rows.
        assert len(ids) == 4
        assert ids == sorted(ids, reverse=True), f"expected id desc, got {ids}"

    async def test_comment_shape_has_identity_fields(self, client, db_session):
        """The history item exposes the same reader-attributed shape as the post
        comment list, plus post context for navigation from the page."""
        import re

        from app.crud import approve_comment

        post = await _create_post(db_session)
        token = await _token(client, display_name="Riki")
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        await approve_comment(db_session, created["id"], approved=True)

        resp = await client.get("/api/reader/me/comments", headers=_auth(token))
        item = resp.json()["items"][0]
        assert item["content"] == created["content"]
        assert item["reader"]["display_name"] == "Riki"
        assert isinstance(item["post"], dict)
        assert re.match(r"^\d{4}-\d{2}-\d{2}T", item["created_at"])
        assert datetime.fromisoformat(item["created_at"].replace("Z", "+00:00")) is not None


class TestDeleteOwnComment:
    async def _own_comment(self, client, db_session, approved=None):
        from app.crud import approve_comment

        post = await _create_post(db_session, slug=f"del-post-{id(self)}")
        token = await _token(client, email=f"del-{id(self)}@example.com", display_name="Del")
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        if approved is not None:
            await approve_comment(db_session, created["id"], approved=approved)
        return post, created["id"], token

    async def test_delete_own_pending_comment(self, client, db_session):
        post, comment_id, token = await self._own_comment(client, db_session)  # left pending
        resp = await client.delete(f"/api/reader/me/comments/{comment_id}", headers=_auth(token))
        assert resp.status_code == 204, resp.text
        assert (await client.get("/api/reader/me/comments", headers=_auth(token))).json()["total"] == 0

    async def test_delete_own_approved_comment(self, client, db_session):
        post, comment_id, token = await self._own_comment(client, db_session, approved=True)
        resp = await client.delete(f"/api/reader/me/comments/{comment_id}", headers=_auth(token))
        assert resp.status_code == 204, resp.text
        assert (await client.get("/api/reader/me/comments", headers=_auth(token))).json()["total"] == 0

    async def test_cannot_delete_another_readers_comment(self, client, db_session):
        _post, comment_id, _token_a = await self._own_comment(client, db_session)
        other = await _token(client, email=f"other-{id(self)}@example.com", display_name="Other")
        resp = await client.delete(f"/api/reader/me/comments/{comment_id}", headers=_auth(other))
        assert resp.status_code == 404, resp.text

    async def test_delete_requires_reader_token(self, client, db_session):
        post, comment_id, _token_a = await self._own_comment(client, db_session)
        resp = await client.delete(f"/api/reader/me/comments/{comment_id}")
        assert resp.status_code == 401


class TestEditOwnComment:
    async def _own_approved(self, client, db_session):
        from app.crud import approve_comment

        post = await _create_post(db_session, slug=f"edit-post-{id(self)}")
        token = await _token(client, email=f"edit-{id(self)}@example.com", display_name="Editor")
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        await approve_comment(db_session, created["id"], approved=True)
        return post, created["id"], token

    async def test_edit_own_approved_comment(self, client, db_session):
        """Editing resets approval (the edited text is new content and must
        pass moderation again) — an approved comment does not silently
        republish replaced text (security review)."""
        post, comment_id, token = await self._own_approved(client, db_session)
        resp = await client.patch(
            f"/api/reader/me/comments/{comment_id}",
            json={"content": "edited body"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["content"] == "edited body"
        assert data["edited_at"] is not None
        # The edit fell back to pending: the public thread no longer lists it
        # until a moderator re-approves the replacement text.
        assert data["is_approved"] is False
        listed = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        assert [c["id"] for c in listed if c["id"] == comment_id] == []

    async def test_edit_taking_approved_comment_public_surface_clears_posts_cache(
        self, client, db_session, monkeypatch
    ):
        """Editing an APPROVED comment drops it off the public surface (its
        comment_count falls on the cached posts list) — the write must clear
        the posts-list cache, not leave a stale higher count for the TTL
        (ISS-608/TASK-529)."""
        from app import crud as crud_module

        calls = []
        monkeypatch.setattr(crud_module, "clear_posts_list_cache", lambda: calls.append(1))
        post, comment_id, token = await self._own_approved(client, db_session)  # auto-approve OFF
        # The seed's approve_comment clears by contract; reset so we only count
        # clears attributable to THIS edit.
        calls.clear()
        resp = await client.patch(
            f"/api/reader/me/comments/{comment_id}",
            json={"content": "edited body taking it off the surface"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert calls, "edit of an approved comment must clear the posts-list cache"

    async def test_edit_with_blank_content_is_422(self, client, db_session):
        # A whitespace-only edit used to store a blank body (re-entering
        # moderation with an empty blob) — the create path rejects it via
        # CommentBase; the edit path must agree (round-297 deep-dive).
        post, comment_id, token = await self._own_approved(client, db_session)
        for blank in ("   ", " \t\n "):
            resp = await client.patch(
                f"/api/reader/me/comments/{comment_id}",
                json={"content": blank},
                headers=_auth(token),
            )
            assert resp.status_code == 422, resp.text

    async def test_edit_republishes_when_verified_reader_trust_tier_enabled(self, client, db_session, monkeypatch):
        """With AUTO_APPROVE_READER_COMMENTS on, an edit republishes through
        the same trust tier as a new comment (DEC-098/100) — consistent, not
        a second, stricter fence."""
        from app.routers import comments as comments_router
        from app.routers import reader as reader_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        monkeypatch.setattr(reader_router, "AUTO_APPROVE_READER_COMMENTS", True)
        post, comment_id, token = await self._own_approved(client, db_session)
        resp = await client.patch(
            f"/api/reader/me/comments/{comment_id}",
            json={"content": "edited body"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_approved"] is True
        listed = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        assert [c["content"] for c in listed if c["id"] == comment_id] == ["edited body"]

    async def test_edit_of_public_comment_does_not_renotify_thread_followers(self, client, db_session, monkeypatch):
        """Editing an already-public comment never leaves the public surface, so
        it must not re-fan out thread notifications to followers (ISS-404): the
        follower seen the original publication; a mere edit is not a new one."""
        from app import models
        from app.routers import comments as comments_router
        from app.routers import reader as reader_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        monkeypatch.setattr(reader_router, "AUTO_APPROVE_READER_COMMENTS", True)

        post = await _create_post(db_session, slug=f"nr-post-{id(self)}")
        fan = await _token(client, email=f"nr-fan-{id(self)}@example.com", display_name="Fan")
        fan_id = (await client.get("/api/reader/me", headers=_auth(fan))).json()["id"]
        db_session.add(models.CommentSubscription(reader_id=fan_id, post_id=post.id))
        await db_session.commit()

        token = await _token(client, email=f"nr-editor-{id(self)}@example.com", display_name="Editor")
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        assert created["is_approved"] is True, created
        # The original publication notified the follower once.
        assert (await client.get("/api/reader/me/notifications", headers=_auth(fan))).json()["total"] == 1

        resp = await client.patch(
            f"/api/reader/me/comments/{created['id']}",
            json={"content": "edited body"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_approved"] is True
        # No duplicate thread notification: the comment stayed public the whole time.
        assert (await client.get("/api/reader/me/notifications", headers=_auth(fan))).json()["total"] == 1

    async def test_edit_of_pending_comment_notifies_on_republish(self, client, db_session, monkeypatch):
        """A comment pending BEFORE the edit genuinely becomes public on the
        auto-approve republish, so followers ARE notified then (ISS-404 keeps
        the notification for real new publications, only)."""
        from app import models
        from app.routers import comments as comments_router
        from app.routers import reader as reader_router

        # Auto-approve off at create: the reader's comment stays pending.
        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", False)
        monkeypatch.setattr(reader_router, "AUTO_APPROVE_READER_COMMENTS", False)

        post = await _create_post(db_session, slug=f"pd-post-{id(self)}")
        fan = await _token(client, email=f"pd-fan-{id(self)}@example.com", display_name="Fan")
        fan_id = (await client.get("/api/reader/me", headers=_auth(fan))).json()["id"]
        db_session.add(models.CommentSubscription(reader_id=fan_id, post_id=post.id))
        await db_session.commit()

        token = await _token(client, email=f"pd-editor-{id(self)}@example.com", display_name="Editor")
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()
        assert created["is_approved"] is False, created
        # Pending → nothing public, no notification yet.
        assert (await client.get("/api/reader/me/notifications", headers=_auth(fan))).json()["total"] == 0

        # The edit republishes through the trust tier → a real new publication
        # that the follower should hear about.
        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        monkeypatch.setattr(reader_router, "AUTO_APPROVE_READER_COMMENTS", True)
        resp = await client.patch(
            f"/api/reader/me/comments/{created['id']}",
            json={"content": "edited body"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["is_approved"] is True
        assert (await client.get("/api/reader/me/notifications", headers=_auth(fan))).json()["total"] == 1

    async def test_cannot_edit_another_readers_comment(self, client, db_session):
        _post, comment_id, token = await self._own_approved(client, db_session)
        other = await _token(client, email=f"edit-other-{id(self)}@example.com", display_name="Other")
        resp = await client.patch(
            f"/api/reader/me/comments/{comment_id}",
            json={"content": "sneaky"},
            headers=_auth(other),
        )
        assert resp.status_code == 404, resp.text

    async def test_edit_requires_reader_token(self, client, db_session):
        _post, comment_id, _token_a = await self._own_approved(client, db_session)
        resp = await client.patch(f"/api/reader/me/comments/{comment_id}", json={"content": "anon"})
        assert resp.status_code == 401

    async def test_edit_unknown_comment_404(self, client, db_session):
        token = await _token(client, email=f"edit-none-{id(self)}@example.com")
        resp = await client.patch(
            "/api/reader/me/comments/999999",
            json={"content": "x"},
            headers=_auth(token),
        )
        assert resp.status_code == 404


class TestDeleteReparentsReplies:
    async def test_delete_own_comment_promotes_its_replies_to_top_level(self, client, db_session):
        from app.crud import approve_comment

        post = await _create_post(db_session, slug=f"del-reply-{id(self)}")
        token = await _token(client, email=f"del-r-{id(self)}@example.com", display_name="Del")
        top = (await _post_comment(client, post.id, headers=_auth(token))).json()
        await approve_comment(db_session, top["id"], approved=True)
        reply = (
            await _post_comment(
                client,
                post.id,
                {"nickname": "x", "email": "x@x.com", "content": "a reply", "parent_id": top["id"]},
            )
        ).json()
        await approve_comment(db_session, reply["id"], approved=True)

        resp = await client.delete(f"/api/reader/me/comments/{top['id']}", headers=_auth(token))
        assert resp.status_code == 204, resp.text

        # The reply survives, now a top-level comment (not orphaned).
        items = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        moved = next((c for c in items if c["id"] == reply["id"]), None)
        assert moved is not None
        assert moved["parent_id"] is None
        # The deleted comment is gone.
        assert all(c["id"] != top["id"] for c in items)


class TestAutoApproveVerifiedReaders:
    """Moderation trust tier (DEC-098, TASK-161): AUTO_APPROVE_READER_COMMENTS."""

    async def test_verified_reader_comment_publishes_immediately_when_enabled(self, client, db_session, monkeypatch):
        from app.routers import comments as comments_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        post = await _create_post(db_session, slug=f"auto-on-{id(self)}")
        token = await _token(client, email=f"auto-on-{id(self)}@example.com", display_name="Auto")
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()

        assert created["is_approved"] is True, "verified reader comment should auto-approve"
        # It is on the public list immediately, with no moderator approve call.
        listed = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        assert any(c["id"] == created["id"] for c in listed)

    async def test_anonymous_comment_stays_pending_when_enabled(self, client, db_session, monkeypatch):
        from app.routers import comments as comments_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", True)
        post = await _create_post(db_session, slug=f"auto-anon-{id(self)}")
        created = (await _post_comment(client, post.id)).json()  # no reader token -> anonymous

        assert created["is_approved"] is False, "anonymous comment must stay moderated"

    async def test_verified_reader_comment_stays_pending_when_disabled(self, client, db_session, monkeypatch):
        from app.routers import comments as comments_router

        monkeypatch.setattr(comments_router, "AUTO_APPROVE_READER_COMMENTS", False)
        post = await _create_post(db_session, slug=f"auto-off-{id(self)}")
        token = await _token(client, email=f"auto-off-{id(self)}@example.com", display_name="Waiter")
        created = (await _post_comment(client, post.id, headers=_auth(token))).json()

        assert created["is_approved"] is False, "flag-off must preserve pending moderation"
        # Not on the public list until the moderator approves.
        listed = (await client.get(f"/api/comments/post/{post.id}")).json()["items"]
        assert not any(c["id"] == created["id"] for c in listed)


class TestFilterAndPaginate:
    """My Comments status filter + pagination (DEC-102, TASK-163)."""

    async def _reader_with_statuses(self, client, db_session, count=3):
        from app.crud import approve_comment

        post = await _create_post(db_session, slug=f"filter-{id(self)}")
        token = await _token(client, email=f"filter-{id(self)}@example.com", display_name="Filterer")
        headers = _auth(token)
        ids = {}
        for i in range(count):
            c = (
                await _post_comment(
                    client,
                    post.id,
                    {"nickname": "x", "email": "x@x.com", "content": f"comment {i}"},
                    headers=headers,
                )
            ).json()
            ids[c["id"]] = c["id"]
            if i == 1:
                await approve_comment(db_session, c["id"], approved=True)
            elif i == 2:
                await approve_comment(db_session, c["id"], approved=False)
            # i == 0 stays pending
        return token, list(ids.values())

    async def test_filter_approved(self, client, db_session):
        token, ids = await self._reader_with_statuses(client, db_session)
        data = (await client.get("/api/reader/me/comments", params={"status": "approved"}, headers=_auth(token))).json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == ids[1]
        assert data["items"][0]["status"] == "approved"

    async def test_filter_rejected(self, client, db_session):
        token, ids = await self._reader_with_statuses(client, db_session)
        data = (await client.get("/api/reader/me/comments", params={"status": "rejected"}, headers=_auth(token))).json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == ids[2]
        assert data["items"][0]["status"] == "rejected"

    async def test_filter_pending(self, client, db_session):
        token, ids = await self._reader_with_statuses(client, db_session)
        data = (await client.get("/api/reader/me/comments", params={"status": "pending"}, headers=_auth(token))).json()
        assert data["total"] == 1
        assert data["items"][0]["id"] == ids[0]
        assert data["items"][0]["status"] == "pending"

    async def test_filter_all(self, client, db_session):
        token, _ids = await self._reader_with_statuses(client, db_session)
        data = (await client.get("/api/reader/me/comments", headers=_auth(token))).json()
        assert data["total"] == 3

    async def test_invalid_status_422(self, client, db_session):
        token, _ids = await self._reader_with_statuses(client, db_session)
        resp = await client.get("/api/reader/me/comments", params={"status": "banana"}, headers=_auth(token))
        assert resp.status_code == 422

    async def test_pagination(self, client, db_session):
        token, _ids = await self._reader_with_statuses(client, db_session, count=3)
        page1 = (
            await client.get(
                "/api/reader/me/comments",
                params={"page": 1, "limit": 2},
                headers=_auth(token),
            )
        ).json()
        assert len(page1["items"]) == 2
        assert page1["total"] == 3
        assert page1["total_pages"] == 2

        page2 = (
            await client.get(
                "/api/reader/me/comments",
                params={"page": 2, "limit": 2},
                headers=_auth(token),
            )
        ).json()
        assert len(page2["items"]) == 1
