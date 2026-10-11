"""Reader passage highlights API contract tests (round 466, DEC-511 / TASK-583).

Covers auth gating, idempotent create, per-reader isolation, note update,
ownership on update/delete, post visibility guarding, and response shape.
"""

HIGHLIGHTS = "/api/reader/me/highlights"


async def _register(client, email="highlighter@example.com", password="readerpass123"):
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


async def _token(client, email="highlighter@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


async def _create_post(db_session, *, published=True, draft=False, **overrides):
    from app.repositories import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    payload = {
        "title": "Highlightable post",
        "slug": f"highlightable-{_slug_counter}",
        "content": "# Heading\n\nSome substantive passage to save.",
        "published": False if draft else published,
        **overrides,
    }
    return await create_post(db_session, PostCreate(**payload))


class TestAuthRequired:
    async def test_list_requires_reader_token(self, client):
        assert (await client.get(HIGHLIGHTS)).status_code == 401

    async def test_admin_token_cannot_list_highlights(self, client, admin_token):
        assert (await client.get(HIGHLIGHTS, headers=_auth(admin_token))).status_code == 401

    async def test_post_requires_reader_token(self, client):
        resp = await client.post(HIGHLIGHTS, json={"post_id": 1, "text": "abc"})
        assert resp.status_code == 401


class TestAddHighlight:
    async def test_create_returns_201_and_appears_in_list(self, client, db_session):
        post = await _create_post(db_session)
        token = await _token(client)
        resp = await client.post(
            HIGHLIGHTS,
            json={"post_id": post.id, "text": "Some substantive passage.", "note": "key idea"},
            headers=_auth(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["text"] == "Some substantive passage."
        assert data["note"] == "key idea"
        assert data["post"]["title"] == post.title
        assert data["post"]["slug"] == post.slug

        listed = (await client.get(HIGHLIGHTS, headers=_auth(token))).json()
        assert listed["total"] == 1
        assert listed["items"][0]["text"] == "Some substantive passage."

    async def test_recreate_same_passage_is_idempotent(self, client, db_session):
        post = await _create_post(db_session)
        token = await _token(client)
        body = {"post_id": post.id, "text": "same passage"}
        first = await client.post(HIGHLIGHTS, json=body, headers=_auth(token))
        second = await client.post(HIGHLIGHTS, json=body, headers=_auth(token))
        assert first.status_code == 201
        assert second.status_code == 200
        assert (await client.get(HIGHLIGHTS, headers=_auth(token))).json()["total"] == 1

    async def test_unknown_and_draft_posts_404(self, client, db_session):
        draft = await _create_post(db_session, draft=True)
        token = await _token(client)
        # Unknown post id
        resp = await client.post(HIGHLIGHTS, json={"post_id": 999999, "text": "x"}, headers=_auth(token))
        assert resp.status_code == 404
        # Draft (exists but not public) — no existence oracle.
        resp = await client.post(HIGHLIGHTS, json={"post_id": draft.id, "text": "x"}, headers=_auth(token))
        assert resp.status_code == 404

    async def test_empty_text_rejected(self, client):
        token = await _token(client)
        resp = await client.post(HIGHLIGHTS, json={"post_id": 1, "text": ""}, headers=_auth(token))
        assert resp.status_code == 422

    async def test_whitespace_only_text_rejected(self, client):
        # min_length=1 counts raw chars, so "   " used to pass validation and
        # then strip to an empty passage; the schema now strips before length
        # validation (same guard as titles/bodies) -> 422.
        token = await _token(client)
        resp = await client.post(HIGHLIGHTS, json={"post_id": 1, "text": "   "}, headers=_auth(token))
        assert resp.status_code == 422

    async def test_text_is_stripped_before_saving(self, client, db_session):
        post = await _create_post(db_session)
        token = await _token(client)
        resp = await client.post(
            HIGHLIGHTS, json={"post_id": post.id, "text": "  trimmed passage  "}, headers=_auth(token)
        )
        assert resp.status_code == 201
        assert resp.json()["text"] == "trimmed passage"


class TestListHighlights:
    async def test_empty_list(self, client):
        token = await _token(client)
        data = (await client.get(HIGHLIGHTS, headers=_auth(token))).json()
        assert data["items"] == []
        assert data["total"] == 0

    async def test_highlights_are_private_per_reader(self, client, db_session):
        post = await _create_post(db_session)
        t1 = await _token(client, email="reader-a@example.com")
        t2 = await _token(client, email="reader-b@example.com")
        await client.post(HIGHLIGHTS, json={"post_id": post.id, "text": "private passage"}, headers=_auth(t1))
        assert (await client.get(HIGHLIGHTS, headers=_auth(t1))).json()["total"] == 1
        assert (await client.get(HIGHLIGHTS, headers=_auth(t2))).json()["total"] == 0

    async def test_post_id_filter_narrows_to_one_post(self, client, db_session):
        post_a = await _create_post(db_session)
        post_b = await _create_post(db_session)
        token = await _token(client)
        for p, text in ((post_a, "passage in a"), (post_b, "passage in b")):
            await client.post(HIGHLIGHTS, json={"post_id": p.id, "text": text}, headers=_auth(token))

        # Unfiltered: both posts' passages.
        all_data = (await client.get(HIGHLIGHTS, headers=_auth(token))).json()
        assert all_data["total"] == 2

        # Filtered: only post_a's passage, still server-side paged/joined.
        a_data = (await client.get(HIGHLIGHTS, params={"post_id": post_a.id}, headers=_auth(token))).json()
        assert a_data["total"] == 1
        assert [i["text"] for i in a_data["items"]] == ["passage in a"]
        assert a_data["items"][0]["post"]["id"] == post_a.id

        # A post with no highlights narrows to empty.
        other = await _create_post(db_session)
        other_data = (await client.get(HIGHLIGHTS, params={"post_id": other.id}, headers=_auth(token))).json()
        assert other_data["items"] == []
        assert other_data["total"] == 0


class TestUpdateNote:
    async def test_owner_can_update_note(self, client, db_session):
        post = await _create_post(db_session)
        token = await _token(client)
        created = (
            await client.post(
                HIGHLIGHTS,
                json={"post_id": post.id, "text": "passage", "note": "old"},
                headers=_auth(token),
            )
        ).json()
        resp = await client.patch(
            f"{HIGHLIGHTS}/{created['id']}",
            json={"note": "refined"},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        assert resp.json()["note"] == "refined"

    async def test_other_reader_cannot_update(self, client, db_session):
        post = await _create_post(db_session)
        owner = await _token(client, email="owner@example.com")
        other = await _token(client, email="other@example.com")
        created = (
            await client.post(HIGHLIGHTS, json={"post_id": post.id, "text": "passage"}, headers=_auth(owner))
        ).json()
        resp = await client.patch(f"{HIGHLIGHTS}/{created['id']}", json={"note": "hijack"}, headers=_auth(other))
        assert resp.status_code == 404

    async def test_missing_highlight_404(self, client):
        token = await _token(client)
        resp = await client.patch(f"{HIGHLIGHTS}/999999", json={"note": "nope"}, headers=_auth(token))
        assert resp.status_code == 404


class TestDeleteHighlight:
    async def test_owner_delete_removes_and_is_idempotent(self, client, db_session):
        post = await _create_post(db_session)
        token = await _token(client)
        created = (
            await client.post(HIGHLIGHTS, json={"post_id": post.id, "text": "passage"}, headers=_auth(token))
        ).json()
        assert (await client.delete(f"{HIGHLIGHTS}/{created['id']}", headers=_auth(token))).status_code == 204
        assert (await client.get(HIGHLIGHTS, headers=_auth(token))).json()["total"] == 0
        # Deleting an already-deleted highlight is a 204 no-op.
        assert (await client.delete(f"{HIGHLIGHTS}/{created['id']}", headers=_auth(token))).status_code == 204

    async def test_other_reader_delete_is_a_noop(self, client, db_session):
        post = await _create_post(db_session)
        owner = await _token(client, email="owner@example.com")
        other = await _token(client, email="other@example.com")
        created = (
            await client.post(HIGHLIGHTS, json={"post_id": post.id, "text": "passage"}, headers=_auth(owner))
        ).json()
        # DELETE is idempotent (204 even when there is nothing to remove for this
        # reader — mirrors the bookmark delete convention): a foreign id is a
        # no-op, never an owner-visible change.
        resp = await client.delete(f"{HIGHLIGHTS}/{created['id']}", headers=_auth(other))
        assert resp.status_code == 204
        # Owner still has it.
        assert (await client.get(HIGHLIGHTS, headers=_auth(owner))).json()["total"] == 1
