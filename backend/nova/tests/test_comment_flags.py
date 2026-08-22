"""Comment flagging tests (DEC-108, TASK-166).

Readers can flag a comment for moderation; one flag per (comment, source) is
enforced (idempotent, no click spam), and the admin list can filter to flagged
comments, show their distinct-flag count, and dismiss the flags.
"""

from app.crud import create_post, flag_comment
from app.schemas import PostCreate


def _post(db_session, slug="flag-post"):
    return create_post(
        db_session,
        PostCreate(title="Flag Post", slug=slug, content="# Hi", published=True),
    )


def _comment(client, post_id, content="flagged content"):
    resp = client.post(
        f"/api/comments/post/{post_id}",
        json={"nickname": "C", "email": "c@example.com", "content": content},
    )
    assert resp.status_code == 201
    return resp.json()


class TestFlagEndpoint:
    def test_flag_comment_new(self, client, db_session):
        post = _post(db_session)
        c = _comment(client, post.id)
        resp = client.post(f"/api/comments/{c['id']}/flag")
        assert resp.status_code == 201, resp.text
        assert resp.json() == {"comment_id": c["id"], "flags": 1, "is_new": True}

    def test_flag_again_is_idempotent(self, client, db_session):
        post = _post(db_session)
        c = _comment(client, post.id)
        assert client.post(f"/api/comments/{c['id']}/flag").status_code == 201
        again = client.post(f"/api/comments/{c['id']}/flag")
        assert again.status_code == 200
        assert again.json()["flags"] == 1
        assert again.json()["is_new"] is False

    def test_flag_unknown_comment_404(self, client):
        assert client.post("/api/comments/999999/flag").status_code == 404

    def test_flag_comment_on_non_public_post_404(self, client, db_session):
        from app import models

        draft = create_post(db_session, PostCreate(title="D", slug="flag-draft", content="# D", published=False))
        comment = models.Comment(
            post_id=draft.id,
            nickname="X",
            email="x@x.com",
            content="hidden",
            is_approved=False,
        )
        db_session.add(comment)
        db_session.flush()
        assert client.post(f"/api/comments/{comment.id}/flag").status_code == 404


class TestCrudDedup:
    def test_distinct_sources_count_separately(self, db_session):
        post = _post(db_session, slug="flag-dedup")
        from app import models

        comment = models.Comment(post_id=post.id, nickname="N", email="n@x", content="x", is_approved=False)
        db_session.add(comment)
        db_session.flush()

        created1, total1 = flag_comment(db_session, comment.id, "ip-A")
        created2, total2 = flag_comment(db_session, comment.id, "ip-A")
        created3, total3 = flag_comment(db_session, comment.id, "ip-B")

        assert (created1, total1) == (True, 1)
        assert (created2, total2) == (False, 1)  # same source -> idempotent
        assert (created3, total3) == (True, 2)  # distinct source -> counted


class TestAdminFlagged:
    def _flagged_comment(self, client, db_session, slug):
        post = _post(db_session, slug=slug)
        c = _comment(client, post.id, content=f"{slug} body")
        flag_comment(db_session, c["id"], "ip-X")
        return post, c["id"]

    def test_admin_list_flagged(self, client, db_session, auth_headers):
        post_f, cid_f = self._flagged_comment(client, db_session, "flag-f")
        post_c, cid_c = self._comment_and_no_flag(client, db_session, "flag-c")

        flagged = client.get("/api/admin/comments", params={"flagged": True}, headers=auth_headers).json()
        item = next((i for i in flagged["items"] if i["id"] == cid_f), None)
        assert item is not None
        assert item["flag_count"] == 1
        assert all(i["id"] != cid_c for i in flagged["items"])

        unflagged = client.get("/api/admin/comments", params={"flagged": False}, headers=auth_headers).json()
        assert any(i["id"] == cid_c for i in unflagged["items"])
        assert not any(i["id"] == cid_f for i in unflagged["items"])

    def _comment_and_no_flag(self, client, db_session, slug):
        post = _post(db_session, slug=slug)
        c = _comment(client, post.id, content=f"{slug} body")
        return post, c["id"]

    def test_dismiss_flags(self, client, db_session, auth_headers):
        post, cid = self._flagged_comment(client, db_session, "flag-dismiss")
        resp = client.delete(f"/api/admin/comments/{cid}/flags", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == {"comment_id": cid, "removed": 1}

        listed = client.get("/api/admin/comments", params={"flagged": True}, headers=auth_headers).json()
        assert not any(i["id"] == cid for i in listed["items"])
