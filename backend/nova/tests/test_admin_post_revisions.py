"""Admin post revision-history tests (DEC-158, TASK-191).

Covers: revision snapshots captured on create/update, list/detail endpoints,
restore (which becomes the live post and is itself undo-able), auth gating,
and the per-post retention cap.
"""

import uuid


async def _create_post(client, auth_headers, content="v0"):
    suffix = uuid.uuid4().hex[:10]
    title = f"Rev Post {suffix}"
    resp = await client.post(
        "/api/admin/posts",
        json={
            "title": title,
            "slug": f"rev-post-{suffix}",
            "content": content,
            "published": False,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"], title


async def _update_post(client, auth_headers, post_id, content):
    resp = await client.put(
        f"/api/admin/posts/{post_id}",
        json={"content": content},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestPostRevisions:
    async def test_requires_admin(self, client):
        assert (await client.get("/api/admin/posts/1/revisions")).status_code == 401

    async def test_editor_allowed(self, client, editor_headers):
        post_id, _ = await _create_post(client, editor_headers)
        resp = await client.get(f"/api/admin/posts/{post_id}/revisions", headers=editor_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    async def test_create_captures_a_revision(self, client, auth_headers):
        post_id, title = await _create_post(client, auth_headers)
        data = (await client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers)).json()
        assert len(data) == 1
        assert data[0]["title"] == title
        assert data[0]["created_at"]
        assert data[0]["published"] is False

    async def test_update_appends_newest_first(self, client, auth_headers):
        post_id, _ = await _create_post(client, auth_headers, "alpha")
        await _update_post(client, auth_headers, post_id, "beta")
        data = (await client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers)).json()
        assert len(data) == 2
        # newest first
        assert data[0]["created_at"] >= data[1]["created_at"]

        # detail of the newest revision reflects the latest save
        rev_id = data[0]["id"]
        detail = (await client.get(f"/api/admin/posts/{post_id}/revisions/{rev_id}", headers=auth_headers)).json()
        assert detail["content"] == "beta"
        assert detail["post_id"] == post_id

    async def test_restore_applies_and_is_undoable(self, client, auth_headers):
        post_id, _ = await _create_post(client, auth_headers, "alpha")
        await _update_post(client, auth_headers, post_id, "beta")

        revisions = (await client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers)).json()
        # newest first: [beta, alpha]
        first_rev_id = revisions[-1]["id"]  # the original "alpha" revision

        restored = await client.post(
            f"/api/admin/posts/{post_id}/revisions/{first_rev_id}/restore",
            headers=auth_headers,
        )
        assert restored.status_code == 200, restored.text
        assert restored.json()["content"] == "alpha"

        # restoring snapshotted the pre-restore "beta" state, so history grew
        history = (await client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers)).json()
        assert len(history) == 3

    async def test_restore_missing_revision_is_404(self, client, auth_headers):
        post_id, _ = await _create_post(client, auth_headers)
        resp = await client.post(
            f"/api/admin/posts/{post_id}/revisions/999999/restore",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_list_missing_post_is_404(self, client, auth_headers):
        assert (await client.get("/api/admin/posts/999999/revisions", headers=auth_headers)).status_code == 404

    async def test_retention_cap_prunes_oldest(self, client, auth_headers, monkeypatch):
        from app import repositories

        monkeypatch.setattr(repositories.posts, "MAX_REVISIONS_PER_POST", 3)
        post_id, _ = await _create_post(client, auth_headers, "0")  # rev 1
        for i in range(1, 5):  # revs 2..5
            await _update_post(client, auth_headers, post_id, f"update {i}")
        data = (await client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers)).json()
        assert len(data) == 3
