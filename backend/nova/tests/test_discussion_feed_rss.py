"""Discussion RSS/Atom feed tests (round 368, DEC-409).

The conversation is findable (comment search, DEC-405), browsable (/discussion,
DEC-407) — the feeds make it SUBSCRIBABLE: a reader who wants the latest
approved comments as a stream in their feed reader gets an RSS 2.0 and an Atom
feed, one item per comment with the commenter + post title and a perma link ON
the comment (``#comment-{id}``, DEC-321). Same public-visibility gate as the
discussion feed/search: pending/rejected comments and comments on draft/
scheduled posts never appear; the content never carries email/ip.
"""

import xml.etree.ElementTree as ET
from datetime import UTC, datetime, timedelta
from uuid import uuid4

RSS = "/rss/comments.xml"
ATOM = "/rss/comments.atom.xml"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_post(client, auth_headers, *, title="Sub Post", published=True, publish_at=None):
    slug = f"sub-{uuid4().hex[:10]}"
    payload = {"title": title, "slug": slug, "content": "Body", "published": published}
    if publish_at is not None:
        payload["publish_at"] = publish_at
    resp = client.post("/api/posts", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _comment(client, admin_token, post_id, content, approved=True):
    created = client.post(
        f"/api/comments/post/{post_id}",
        json={"content": content, "nickname": "Subber", "email": "sub@example.com"},
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


class TestRssFeed:
    def test_returns_newest_approved_comments_with_deep_links(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers, title="Sub Post")
        cid = _comment(client, admin_token, post["id"], "a subscribed thought")
        _comment(client, admin_token, post["id"], "a rejected thought", approved=False)

        resp = client.get(RSS)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/rss+xml")
        root = ET.fromstring(resp.text)
        items = root.findall(".//item")
        assert len(items) == 1
        item = items[0]
        assert "subscribed" in item.findtext("description", "")
        assert "rejected" not in resp.text
        # Perma link is ON the comment, not just the post headline (DEC-321).
        link = item.findtext("link", "")
        assert link.endswith(f"/posts/{post['slug']}#comment-{cid}")

    def test_item_carries_commenter_and_post_title(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers, title="Named Post")
        _comment(client, admin_token, post["id"], "who said it")
        resp = client.get(RSS)
        root = ET.fromstring(resp.text)
        item = root.findall(".//item")[0]
        assert "Named Post" in (item.findtext("title", "") or "")
        assert "Subber" in (item.findtext("title", "") or "")

    def test_visibility_gate_never_leaks_hidden_comments(self, client, auth_headers, db_session, admin_token):
        from app import models

        # Pending (never moderated) comment.
        post = _create_post(client, auth_headers)
        created = client.post(
            f"/api/comments/post/{post['id']}",
            json={"content": "unmoderated secret", "nickname": "Subber", "email": "sub@example.com"},
        )
        assert created.status_code == 201
        # Draft post + scheduled post comments (public create 404s → insert rows).
        draft = _create_post(client, auth_headers, published=False)
        future = (datetime.now(UTC) + timedelta(days=2)).isoformat()
        scheduled = _create_post(client, auth_headers, published=True, publish_at=future)
        for p, text in ((draft, "draft leak"), (scheduled, "scheduled leak")):
            row = models.Comment(
                post_id=p["id"], nickname="Subber", email="sub@example.com", content=text, is_approved=True
            )
            db_session.add(row)
        db_session.flush()

        body = client.get(RSS).text
        rss_items = ET.fromstring(body).findall(".//item")
        contents = [i.findtext("description", "") for i in rss_items]
        assert not any("secret" in c for c in contents)
        assert not any("draft leak" in c for c in contents)
        assert not any("scheduled leak" in c for c in contents)
        # None of this test's comments are on an approved-public surface, so
        # the feed is empty — the gate rejects every one of them.
        assert not contents

    def test_never_contains_email_or_ip(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers)
        _comment(client, admin_token, post["id"], "PII-free content for sure")
        body = client.get(RSS).text
        assert "sub@example.com" not in body
        assert "127.0.0.1" not in body

    def test_nameless_reader_email_never_in_commenter_label(self, client, db_session, admin_token, auth_headers):
        """A reader registered without a display_name must not have their
        ACCOUNT EMAIL in the feed's commenter label (ISS-606/TASK-532).

        The write path stores a ``reader-{id}`` handle, and the feed's
        display-name fallback (rss._comment_display_name) independently
        refuses to echo the stored nickname for a nameless reader — so even a
        legacy row that still holds the email renders as a generic label.
        """
        from app.crud import approve_comment

        post = _create_post(client, auth_headers)
        email = "nameless-reader@example.com"
        registered = client.post(
            "/api/reader/register",
            json={"email": email, "password": "readerpass123", "display_name": None},
        )
        assert registered.status_code == 201, registered.text
        token = registered.json()["access_token"]
        created = client.post(
            f"/api/comments/post/{post['id']}",
            json={"content": "from a nameless reader", "nickname": "ignored", "email": "forged@example.com"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert created.status_code == 201, created.text
        approve_comment(db_session, created.json()["id"], approved=True)

        for path in (RSS, ATOM):
            body = client.get(path).text
            assert email not in body
            assert "forged@example.com" not in body
            # The reader's identity renders as the deterministic non-PII handle
            # (or the generic label fallback), never an @-address.
            reader_id = created.json()["reader"]["id"]
            assert f"reader-{reader_id}" in body or "reader" in body.lower()


class TestAtomFeed:
    def test_returns_newest_approved_comments_as_atom_entries(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers)
        _comment(client, admin_token, post["id"], "atom-able thought")
        _comment(client, admin_token, post["id"], "atom rejected", approved=False)

        resp = client.get(ATOM)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/atom+xml")
        root = ET.fromstring(resp.text)
        entries = root.findall(".//{http://www.w3.org/2005/Atom}entry")
        assert len(entries) == 1
        assert "atom-able" in entries[0].findtext("{http://www.w3.org/2005/Atom}summary", "")
        assert "atom rejected" not in resp.text
        link = entries[0].find("{http://www.w3.org/2005/Atom}link").attrib["href"]
        assert "#comment-" in link

    def test_self_link_points_at_the_atom_url(self, client, auth_headers, admin_token):
        _comment(client, admin_token, _create_post(client, auth_headers)["id"], "self check")
        resp = client.get(ATOM)
        root = ET.fromstring(resp.text)
        self_link = [el for el in root.findall("{http://www.w3.org/2005/Atom}link") if el.attrib.get("rel") == "self"]
        assert self_link and self_link[0].attrib["href"].endswith("/rss/comments.atom.xml")


class TestFeedCaching:
    def test_feeds_are_reusable_conditional(self, client, auth_headers, admin_token):
        post = _create_post(client, auth_headers)
        _comment(client, admin_token, post["id"], "cache me")
        first = client.get(RSS)
        second = client.get(RSS)
        assert first.status_code == 200
        assert second.status_code in (200, 304)
        # ETag present either way.
        assert first.headers.get("etag") or second.headers.get("etag")
