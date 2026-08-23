"""Admin comment-activity analytics tests (DEC-154, TASK-189)."""

COMMENTS_STATS = "/api/admin/stats/comments"
_n = 0


def _create_post(client, auth_headers):
    global _n
    _n += 1
    resp = client.post(
        "/api/posts",
        json={"title": f"Post {_n}", "slug": f"ca-post-{_n}", "content": "body", "published": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_comment(client, post_id, body="nice post"):
    resp = client.post(
        f"/api/comments/post/{post_id}",
        json={"content": body, "nickname": "Reader", "email": "r@example.com"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _approve(client, auth_headers, comment_id):
    resp = client.patch(f"/api/comments/{comment_id}/approve", json={"approved": True}, headers=auth_headers)
    assert resp.status_code == 200, resp.text


class TestCommentActivity:
    def test_requires_admin(self, client):
        assert client.get(COMMENTS_STATS).status_code == 401

    def test_editor_allowed(self, client, editor_headers):
        assert client.get(COMMENTS_STATS, headers=editor_headers).status_code == 200

    def test_empty_when_no_approved_comments(self, client, auth_headers):
        post = _create_post(client, auth_headers)
        c = _create_comment(client, post["id"])
        # pending comment not counted until approved
        data = client.get(COMMENTS_STATS, headers=auth_headers).json()
        assert data["total"] == 0
        _approve(client, auth_headers, c["id"])

    def test_counts_approved_comments_and_top_posts(self, client, auth_headers):
        p1 = _create_post(client, auth_headers)
        p2 = _create_post(client, auth_headers)
        for _ in range(3):
            _approve(client, auth_headers, _create_comment(client, p1["id"])["id"])
        _approve(client, auth_headers, _create_comment(client, p2["id"])["id"])

        data = client.get(COMMENTS_STATS, headers=auth_headers).json()
        assert data["total"] == 4
        assert data["series"] and data["series"][-1]["count"] >= 4
        top = data["top_posts"]
        assert top and top[0]["id"] == p1["id"]
        assert top[0]["count"] == 3

    def test_excludes_unapproved_comments(self, client, auth_headers):
        post = _create_post(client, auth_headers)
        _create_comment(client, post["id"], "pending one")
        approved = _create_comment(client, post["id"], "approved one")
        _approve(client, auth_headers, approved["id"])

        data = client.get(COMMENTS_STATS, headers=auth_headers).json()
        assert data["total"] == 1
        assert data["top_posts"][0]["count"] == 1
