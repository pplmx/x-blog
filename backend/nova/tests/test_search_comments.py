"""Public comment search tests (round 366, DEC-405).

Post search covered posts only; /api/search/comments lets a reader find a
DISCUSSION — any approved comment on a publicly-visible post whose content
matches, newest first, with a highlighted snippet and the post brief so the
result can land on the exact comment. The public-visibility contract mirrors
post search and list_reader_public_comments: pending/rejected comments, and
comments on a draft or not-yet-published post, never match; emails/IPs never
leak; PII-free reader identity rides the CommentPublic envelope.
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

SEARCH = "/api/search/comments"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_post(client, auth_headers, *, title="CS Post", published=True, publish_at=None, content="Body"):
    slug = f"cs-{uuid4().hex[:10]}"
    payload = {
        "title": title,
        "slug": slug,
        "content": content,
        "published": published,
    }
    if publish_at is not None:
        payload["publish_at"] = publish_at
    resp = await client.post("/api/posts", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _comment(client, admin_token, post_id, content, approved=True, token=None):
    """Create a comment on a post (optionally as a reader) and moderate it."""
    headers = _auth(token) if token else {}
    created = await client.post(
        f"/api/comments/post/{post_id}",
        # CommentCreate requires nickname/email for everything; a reader-
        # attributed comment sends placeholders (stamped from the JWT).
        json={"content": content, "nickname": "CS", "email": "cs@example.com"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    cid = created.json()["id"]
    resp = await client.patch(
        f"/api/comments/{cid}/approve",
        json={"approved": approved},
        headers=_auth(admin_token),
    )
    assert resp.status_code == 200, resp.text
    return cid


async def _register_reader(client, tag):
    resp = await client.post(
        "/api/reader/register",
        json={"email": f"cs-{tag}@example.com", "password": "readerpass123", "display_name": f"CS {tag}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _direct_comment(db_session, post_id, content):
    """Insert an approved comment row directly (the public create endpoint 404s
    for non-publicly-visible posts — exactly the visibility we are testing)."""
    from app import models

    row = models.Comment(
        post_id=post_id,
        nickname="CS",
        email="cs@example.com",
        content=content,
        is_approved=True,
    )
    db_session.add(row)
    await db_session.flush()  # populate id + make it visible to the shared session
    return row.id


class TestBoundary:
    async def test_whitespace_query_rejected(self, client):
        resp = await client.get(SEARCH, params={"q": " "})
        assert resp.status_code == 422

    async def test_overlong_query_rejected(self, client):
        resp = await client.get(SEARCH, params={"q": "x" * 201})
        assert resp.status_code == 422

    async def test_limit_above_max_rejected(self, client):
        resp = await client.get(SEARCH, params={"q": "term", "limit": 51})
        assert resp.status_code == 422

    async def test_literal_percent_and_underscore_match_literally(self, client, auth_headers, admin_token):
        """% and _ are LIKE metacharacters that must NOT act as wildcards: a
        reader searching "100%" finds only the literal "100%", and "_" is not a
        single-char wildcard (escape_like_pattern, review feedback)."""
        post = await _create_post(client, auth_headers)
        pct_id = await _comment(client, admin_token, post["id"], "discount is 100% today", approved=True)
        und_id = await _comment(client, admin_token, post["id"], "use the field_name", approved=True)

        # "%" escaped → matches only the comment containing a literal percent.
        items = (await client.get(SEARCH, params={"q": "100%"})).json()["items"]
        assert [i["id"] for i in items] == [pct_id]

        # "_" escaped → "field_name" matches only as a whole term, not any
        # single-char-wildcard expansion (e.g. "fieldXname" absent → no hit).
        assert (await client.get(SEARCH, params={"q": "200%"})).json()["items"] == []
        items2 = (await client.get(SEARCH, params={"q": "field_name"})).json()["items"]
        assert [i["id"] for i in items2] == [und_id]
        assert (await client.get(SEARCH, params={"q": "fieldAname"})).json()["items"] == []

    async def test_snippet_is_xss_safe(self, client, auth_headers, admin_token):
        """Comment text with HTML never rides into the snippet unescaped — the
        highlighter escapes before <mark>, so a script tag cannot be injected
        through search results."""
        post = await _create_post(client, auth_headers)
        await _comment(
            client,
            admin_token,
            post["id"],
            'innocent text <script>alert("xss")</script> and more',
            approved=True,
        )
        resp = await client.get(SEARCH, params={"q": "innocent"})
        assert resp.status_code == 200
        snippet = resp.json()["items"][0]["snippet"]
        assert "<script>" not in snippet
        assert "<mark>innocent</mark>" in snippet


class TestMatching:
    async def test_finds_approved_comment_on_public_post(self, client, auth_headers, admin_token):
        post = await _create_post(client, auth_headers, title="Scheduled-ish", content="Unrelated body")
        await _comment(client, admin_token, post["id"], "the answer is 42 in the discussion", approved=True)
        resp = await client.get(SEARCH, params={"q": "42"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 1
        item = items[0]
        # The snippet is highlighted (mark-safe)…
        assert "<mark>42</mark>" in item["snippet"]
        # …and carries the post brief so the result can land on the comment.
        assert item["post"] == {"id": post["id"], "title": "Scheduled-ish", "slug": post["slug"]}
        assert item["post_id"] == post["id"]
        # Never the PII columns.
        assert "email" not in item
        assert "ip_address" not in item

    async def test_every_term_must_match(self, client, auth_headers, admin_token):
        await _comment(
            client, admin_token, (await _create_post(client, auth_headers))["id"], "TypeScript 类型 安全", approved=True
        )
        resp = await client.get(SEARCH, params={"q": "TypeScript 类型"})
        assert resp.status_code == 200
        assert any("TypeScript" in (i["snippet"] or "") for i in resp.json()["items"])
        # A term absent from content → no match (substring AND semantics).
        resp2 = await client.get(SEARCH, params={"q": "TypeScript 不存在词"})
        assert resp2.json()["items"] == []

    async def test_pending_and_rejected_comments_never_match(self, client, auth_headers, admin_token):
        post = await _create_post(client, auth_headers)
        await _comment(client, admin_token, post["id"], "pending phrase zzz", approved=False)  # rejected
        # A pending comment (never moderated) also stays out.
        created = await client.post(
            f"/api/comments/post/{post['id']}",
            json={"content": "still pending zzz", "nickname": "CS", "email": "cs@example.com"},
        )
        assert created.status_code == 201
        resp = await client.get(SEARCH, params={"q": "zzz"})
        assert resp.json()["pagination"]["total"] == 0


class TestVisibility:
    async def test_draft_post_comment_never_matches(self, client, auth_headers, db_session):
        post = await _create_post(client, auth_headers, published=False)
        await _direct_comment(db_session, post["id"], "secret draft discussion")
        resp = await client.get(SEARCH, params={"q": "secret"})
        assert resp.json()["pagination"]["total"] == 0

    async def test_future_scheduled_post_comment_never_matches(self, client, auth_headers, db_session):
        future = (datetime.now(UTC) + timedelta(days=2)).isoformat()
        post = await _create_post(client, auth_headers, published=True, publish_at=future)
        await _direct_comment(db_session, post["id"], "not yet public take")
        resp = await client.get(SEARCH, params={"q": "public"})
        assert resp.json()["pagination"]["total"] == 0


class TestEnvelope:
    async def test_pagination(self, client, auth_headers, admin_token):
        post = await _create_post(client, auth_headers)
        for i in range(3):
            await _comment(client, admin_token, post["id"], f"matching term {i}", approved=True)
        p1 = (await client.get(SEARCH, params={"q": "matching", "limit": 2, "page": 1})).json()
        assert p1["pagination"]["total"] == 3
        assert len(p1["items"]) == 2
        p2 = (await client.get(SEARCH, params={"q": "matching", "limit": 2, "page": 2})).json()
        assert len(p2["items"]) == 1
        assert p2["pagination"]["page"] == 2

    async def test_newest_first_with_id_tiebreak(self, client, auth_headers, admin_token):
        post = await _create_post(client, auth_headers)
        for i in range(3):
            await _comment(client, admin_token, post["id"], f"shared term {i}", approved=True)
        items = (await client.get(SEARCH, params={"q": "shared"})).json()["items"]
        ids = [i["id"] for i in items]
        assert ids == sorted(ids, reverse=True)  # newest first

    async def test_reader_attributed_comment_carries_public_identity(self, client, auth_headers, admin_token):
        reg = await _register_reader(client, "search")
        token = reg["access_token"]
        pub_name = reg["reader"]["display_name"]
        post = await _create_post(client, auth_headers)
        cid = await _comment(
            client, admin_token, post["id"], "reader searchable contribution", approved=True, token=token
        )
        resp = await client.get(SEARCH, params={"q": "searchable"})
        assert resp.status_code == 200
        item = next(i for i in resp.json()["items"] if i["id"] == cid)
        assert item["reader"] is not None
        assert item["reader"]["display_name"] == pub_name
        assert item["reader"]["id"] == reg["reader"]["id"]  # CommentReaderProfile shape
        assert "email" not in item
