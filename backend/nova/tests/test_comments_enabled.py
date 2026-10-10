"""Per-post comment control (round 351).

``posts.comments_enabled`` lets an operator close the door on a post's
comments — stale content, privacy, high-noise threads — without deleting the
conversation or disabling comments site-wide. Existing comments stay visible;
only new comment creation is gated (403). This covers the default (posts are
comments-open), the admin toggle round-trip through the editor path, the 403
gate (guest + reader, whose auto-approve shortcut must not bypass it), and
that a closed post's comment list is unaffected.
"""

from app import models


async def _make_post(db, **kw) -> models.Post:
    defaults = {"title": "Gate Post", "slug": "gate-post", "content": "x", "published": True}
    defaults.update(kw)
    post = models.Post(**defaults)
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return post


async def test_comments_open_by_default(client, db_session):
    post = await _make_post(db_session)
    assert post.comments_enabled is True
    resp = await client.post(
        f"/api/comments/post/{post.id}",
        json={"nickname": "Guest", "email": "guest@example.com", "content": "hi there"},
    )
    assert resp.status_code == 201


async def test_closed_post_refuses_new_comments(client, db_session):
    post = await _make_post(db_session, slug="closed-post", comments_enabled=False)
    resp = await client.post(
        f"/api/comments/post/{post.id}",
        json={"nickname": "Guest", "email": "guest@example.com", "content": "still trying"},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["message"] == "Comments are closed on this post"


async def test_closed_post_still_lists_existing_comments(client, auth_headers, db_session):
    """The conversation belongs to the article: closing the door keeps every
    existing comment visible and reachable — only new creation is refused."""
    post = await _make_post(db_session, slug="with-comments")
    # A comment that was approved while the post was still open.
    made = await client.post(
        f"/api/comments/post/{post.id}",
        json={"nickname": "Guest", "email": "guest@example.com", "content": "old one"},
    )
    assert made.status_code == 201
    cid = made.json()["id"]
    approved = await client.patch(
        f"/api/comments/{cid}/approve",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"approved": True},
    )
    assert approved.status_code == 200
    post.comments_enabled = False
    await db_session.commit()
    # Async: an expired instance reloads ALL attributes on first access →
    # MissingGreenlet, so pin the scalar identifiers before expiring.
    post_id, post_slug = post.id, post.slug
    db_session.expire_all()

    resp = await client.get(f"/api/posts/{post_slug}")
    assert resp.status_code == 200
    # The public post advertises the closed state so the UI can show a notice.
    assert resp.json()["comments_enabled"] is False

    listing = await client.get(f"/api/comments/post/{post_id}")
    assert listing.status_code == 200
    assert [c["content"] for c in listing.json()["items"]] == ["old one"]


async def test_reader_autoapprove_does_not_bypass_the_gate(client, db_session):
    """The verified-reader auto-approve shortcut runs AFTER creation, so the
    create-time 403 must fire first — a closed post rejects even an
    auto-approved reader's comment."""
    from app.auth import ReaderAccount, create_reader_token

    post = await _make_post(db_session, slug="no-autoapprove", comments_enabled=False)
    reader = ReaderAccount(
        email="reader@g.com",
        display_name="R",
        password="x",
    )
    db_session.add(reader)
    await db_session.commit()
    await db_session.refresh(reader)
    token = create_reader_token({"sub": reader.id})
    resp = await client.post(
        f"/api/comments/post/{post.id}",
        json={"nickname": "Reader", "email": "", "content": "auto-approve me"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_admin_toggle_round_trip(client, auth_headers, db_session):
    post = await _make_post(db_session, slug="close-me")
    assert post.comments_enabled is True

    # Editor closes comments.
    resp = await client.put(
        f"/api/admin/posts/{post.id}",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"comments_enabled": False},
    )
    assert resp.status_code == 200
    await db_session.refresh(post)
    assert post.comments_enabled is False
    # Async: an expired instance reloads ALL attributes (incl. lazy collections)
    # on first access → MissingGreenlet, so keep a stable scalar id around.
    post_id = post.id
    db_session.expire_all()

    # And re-opens them.
    resp = await client.put(
        f"/api/admin/posts/{post_id}",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"comments_enabled": True},
    )
    assert resp.status_code == 200
    db_session.expire_all()
    assert (await db_session.get(models.Post, post_id)).comments_enabled is True


async def test_create_with_comments_closed_persists(client, auth_headers):
    resp = await client.post(
        "/api/admin/posts",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"title": "Closed From Birth", "slug": "closed-birth", "content": "x", "comments_enabled": False},
    )
    assert resp.status_code == 201
    pid = resp.json()["id"]
    detail = await client.get(f"/api/admin/posts/{pid}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["comments_enabled"] is False
