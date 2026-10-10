"""Admin comment-activity analytics tests (DEC-154, TASK-189)."""

COMMENTS_STATS = "/api/admin/stats/comments"
_n = 0


async def _create_post(client, auth_headers):
    global _n
    _n += 1
    resp = await client.post(
        "/api/posts",
        json={"title": f"Post {_n}", "slug": f"ca-post-{_n}", "content": "body", "published": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_comment(client, post_id, body="nice post"):
    resp = await client.post(
        f"/api/comments/post/{post_id}",
        json={"content": body, "nickname": "Reader", "email": "r@example.com"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _approve(client, auth_headers, comment_id):
    resp = await client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


class TestCommentActivity:
    async def test_requires_admin(self, client):
        assert (await client.get(COMMENTS_STATS)).status_code == 401

    async def test_editor_allowed(self, client, editor_headers):
        assert (await client.get(COMMENTS_STATS, headers=editor_headers)).status_code == 200

    async def test_empty_when_no_approved_comments(self, client, auth_headers):
        post = await _create_post(client, auth_headers)
        c = await _create_comment(client, post["id"])
        # pending comment not counted until approved
        data = (await client.get(COMMENTS_STATS, headers=auth_headers)).json()
        assert data["total"] == 0
        await _approve(client, auth_headers, c["id"])

    async def test_counts_approved_comments_and_top_posts(self, client, auth_headers):
        p1 = await _create_post(client, auth_headers)
        p2 = await _create_post(client, auth_headers)
        for _ in range(3):
            await _approve(client, auth_headers, (await _create_comment(client, p1["id"]))["id"])
        await _approve(client, auth_headers, (await _create_comment(client, p2["id"]))["id"])

        data = (await client.get(COMMENTS_STATS, headers=auth_headers)).json()
        assert data["total"] == 4
        assert data["series"] and data["series"][-1]["count"] >= 4
        top = data["top_posts"]
        assert top and top[0]["id"] == p1["id"]
        assert top[0]["count"] == 3

    async def test_excludes_unapproved_comments(self, client, auth_headers):
        post = await _create_post(client, auth_headers)
        await _create_comment(client, post["id"], "pending one")
        approved = await _create_comment(client, post["id"], "approved one")
        await _approve(client, auth_headers, approved["id"])

        data = (await client.get(COMMENTS_STATS, headers=auth_headers)).json()
        assert data["total"] == 1
        assert data["top_posts"][0]["count"] == 1

    async def test_pending_count_is_the_unreviewed_queue_depth(self, client, auth_headers, db_session):
        """pending_count counts only unreviewed comments — a rejected comment
        (reviewed_at stamped) must not inflate it (round 276: the moderation
        backlog moved from the public /api/stats to this admin-scoped
        endpoint; see also test_stats::test_stats_no_longer_exposes_pending)."""
        from datetime import datetime

        from sqlalchemy import select

        from app import models

        post = await _create_post(client, auth_headers)
        await _create_comment(client, post["id"], "still pending")
        await _create_comment(client, post["id"], "to be rejected")
        rejected = (
            (await db_session.execute(select(models.Comment).where(models.Comment.content == "to be rejected")))
            .scalars()
            .first()
        )
        rejected.reviewed_at = datetime(2024, 1, 1)
        await db_session.commit()

        data = (await client.get(COMMENTS_STATS, headers=auth_headers)).json()
        assert data["pending_count"] == 1
        assert data["total"] == 0  # nothing approved yet
