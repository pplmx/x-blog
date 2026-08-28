"""Admin post revision-history tests (DEC-158, TASK-191).

Covers: revision snapshots captured on create/update, list/detail endpoints,
restore (which becomes the live post and is itself undo-able), auth gating,
and the per-post retention cap.
"""

import uuid

from app import crud


def _create_post(client, auth_headers, content="v0"):
    suffix = uuid.uuid4().hex[:10]
    title = f"Rev Post {suffix}"
    resp = client.post(
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


def _update_post(client, auth_headers, post_id, content):
    resp = client.put(
        f"/api/admin/posts/{post_id}",
        json={"content": content},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestPostRevisions:
    def test_requires_admin(self, client):
        assert client.get("/api/admin/posts/1/revisions").status_code == 401

    def test_editor_allowed(self, client, editor_headers):
        post_id, _ = _create_post(client, editor_headers)
        resp = client.get(f"/api/admin/posts/{post_id}/revisions", headers=editor_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_create_captures_a_revision(self, client, auth_headers):
        post_id, title = _create_post(client, auth_headers)
        data = client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers).json()
        assert len(data) == 1
        assert data[0]["title"] == title
        assert data[0]["created_at"]
        assert data[0]["published"] is False

    def test_update_appends_newest_first(self, client, auth_headers):
        post_id, _ = _create_post(client, auth_headers, "alpha")
        _update_post(client, auth_headers, post_id, "beta")
        data = client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers).json()
        assert len(data) == 2
        # newest first
        assert data[0]["created_at"] >= data[1]["created_at"]

        # detail of the newest revision reflects the latest save
        rev_id = data[0]["id"]
        detail = client.get(f"/api/admin/posts/{post_id}/revisions/{rev_id}", headers=auth_headers).json()
        assert detail["content"] == "beta"
        assert detail["post_id"] == post_id

    def test_restore_applies_and_is_undoable(self, client, auth_headers):
        post_id, _ = _create_post(client, auth_headers, "alpha")
        _update_post(client, auth_headers, post_id, "beta")

        revisions = client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers).json()
        # newest first: [beta, alpha]
        first_rev_id = revisions[-1]["id"]  # the original "alpha" revision

        restored = client.post(
            f"/api/admin/posts/{post_id}/revisions/{first_rev_id}/restore",
            headers=auth_headers,
        )
        assert restored.status_code == 200, restored.text
        assert restored.json()["content"] == "alpha"

        # restoring snapshotted the pre-restore "beta" state, so history grew
        history = client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers).json()
        assert len(history) == 3

    def test_restore_missing_revision_is_404(self, client, auth_headers):
        post_id, _ = _create_post(client, auth_headers)
        resp = client.post(
            f"/api/admin/posts/{post_id}/revisions/999999/restore",
            headers=auth_headers,
        )
        assert resp.status_code == 404

    def test_list_missing_post_is_404(self, client, auth_headers):
        assert client.get("/api/admin/posts/999999/revisions", headers=auth_headers).status_code == 404

    def test_retention_cap_prunes_oldest(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(crud, "MAX_REVISIONS_PER_POST", 3)
        post_id, _ = _create_post(client, auth_headers, "0")  # rev 1
        for i in range(1, 5):  # revs 2..5
            _update_post(client, auth_headers, post_id, f"update {i}")
        data = client.get(f"/api/admin/posts/{post_id}/revisions", headers=auth_headers).json()
        assert len(data) == 3
