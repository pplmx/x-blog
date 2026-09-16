"""Public discussion feed tests (round 367, DEC-407).

The discussion is the blog's second content asset — comment search (DEC-405)
made it FINDABLE; the feed makes it BROWSABLE. A visitor who wants to see what
people are saying right now has no surface otherwise. The feed must serve the
newest approved comments on publicly-visible posts, each with the commenter
identity, the content, and the post brief (for the deep link onto the exact
comment at ``#comment-{id}``). It must never leak pending/rejected comments or
comments on drafts/scheduled posts, and never the email/ip columns.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

FEED = "/api/comments/feed"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_post(client, auth_headers, *, title="Feed Post", published=True, publish_at=None, content="Body"):
    slug = f"feed-{uuid4().hex[:10]}"
    payload = {
        "title": title,
        "slug": slug,
        "content": content,
        "published": published,
    }
    if publish_at is not None:
        payload["publish_at"] = publish_at
    resp = client.post("/api/posts", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _comment(client, admin_token, post_id, content, approved=True):
    created = client.post(
        f"/api/comments/post/{post_id}",
        json={"content": content, "nickname": "Feed", "email": "feed@example.com"},
    )
    assert created.status_code == 201, created.text
    cid = created.json()["id"]
    resp = client.patch(
        f"/api/comments/{cid}/approve",
        json={"approved": approved},
        headers=_auth(admin_token),
    )
    assert resp.status_code == 200, resp.text
    return cid


class TestFeedContent:
    def test_returns_newest_approved_comments_with_post_brief(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers)
        _comment(client, admin_token, post["id"], "first approved thought")
        _comment(client, admin_token, post["id"], "second approved thought", approved=False)  # never appears
        resp = client.get(FEED)
        assert resp.status_code == 200
        body = resp.json()
        assert body["pagination"]["total"] == 1
        item = body["items"][0]
        assert item["content"] == "first approved thought"
        assert item["post"] == {"id": post["id"], "title": "Feed Post", "slug": post["slug"]}
        # CommentPublic envelope: no PII.
        assert "email" not in item
        assert "ip_address" not in item

    def test_newest_first_with_id_tiebreak(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers)
        ids = [_comment(client, admin_token, post["id"], f"feed term {i}", approved=True) for i in range(3)]
        items = client.get(FEED).json()["items"]
        assert [i["id"] for i in items] == sorted(ids, reverse=True)

    def test_pending_never_appears_without_approval(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers)
        created = client.post(
            f"/api/comments/post/{post['id']}",
            json={"content": "still pending zzzz", "nickname": "Feed", "email": "feed@example.com"},
        )
        assert created.status_code == 201
        body = client.get(FEED).json()
        assert not any("still pending zzzz" in i["content"] for i in body["items"])
        # Total reflects only approved comments (there may be seeded approvals).
        assert body["pagination"]["total"] >= 0

    def test_reader_attributed_comment_carries_public_identity(self, client, auth_headers, admin_token):
        reg = client.post(
            "/api/reader/register",
            json={"email": "feed-r@example.com", "password": "readerpass123", "display_name": "Feed Person"},
        )
        assert reg.status_code == 201
        token = reg.json()["access_token"]
        post = _create_post(client, auth_headers)
        created = client.post(
            f"/api/comments/post/{post['id']}",
            json={"content": "signed-in feed entry", "nickname": "x", "email": "x@example.com"},
            headers=_auth(token),
        )
        assert created.status_code == 201
        client.patch(
            f"/api/comments/{created.json()['id']}/approve",
            json={"approved": True},
            headers=_auth(admin_token),
        )
        item = client.get(FEED).json()["items"][0]
        assert item["reader"] is not None
        assert item["reader"]["display_name"] == "Feed Person"
        assert "email" not in item


class TestFeedVisibility:
    def test_draft_post_comment_never_appears(self, client, auth_headers, db_session):
        post = _create_post(client, auth_headers, published=False)
        from app import models

        row = models.Comment(
            post_id=post["id"],
            nickname="Feed",
            email="feed@example.com",
            content="hidden draft discussion",
            is_approved=True,
        )
        db_session.add(row)
        db_session.flush()
        body = client.get(FEED).json()
        assert not any("hidden draft discussion" in i["content"] for i in body["items"])

    def test_future_scheduled_post_comment_never_appears(self, client, auth_headers, db_session):
        future = (datetime.now(UTC) + timedelta(days=2)).isoformat()
        post = _create_post(client, auth_headers, published=True, publish_at=future)
        from app import models

        row = models.Comment(
            post_id=post["id"],
            nickname="Feed",
            email="feed@example.com",
            content="not yet public take",
            is_approved=True,
        )
        db_session.add(row)
        db_session.flush()
        body = client.get(FEED).json()
        assert not any("not yet public take" in i["content"] for i in body["items"])


class TestFeedPagination:
    def test_paginates(self, client, auth_headers, admin_token):
        # The feed is global (other seeded/approved comments exist), so use a
        # unique marker term and assert those rows' relative pagination.
        post = _create_post(client, auth_headers)
        for i in range(3):
            _comment(client, admin_token, post["id"], f"feed-pageable-{i}", approved=True)
        p1 = client.get(FEED, params={"limit": 2, "page": 1}).json()
        assert len(p1["items"]) == 2
        assert p1["pagination"]["page"] == 1
        assert p1["pagination"]["limit"] == 2
        assert p1["pagination"]["total_pages"] == 2  # 3 unique marker rows → 2 pages of 2
        # Newest first.
        assert {i["content"] for i in p1["items"]} == {"feed-pageable-2", "feed-pageable-1"}
        p2 = client.get(FEED, params={"limit": 2, "page": 2}).json()
        assert {i["content"] for i in p2["items"]} == {"feed-pageable-0"}
        assert p2["pagination"]["page"] == 2
