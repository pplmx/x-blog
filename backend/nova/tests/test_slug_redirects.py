"""Slug-change redirects (round 350).

When a post / series / static page is re-slugged in the admin, the old URL
must keep resolving: the public routes answer 404 (contract unchanged) with an
``X-Redirect-To`` header the web layer turns into a permanent 301. This file
covers capture at re-slug time, resolution (with chain collapse when a slug
moves more than once), and that an unknown slug carries no redirect.
"""

from app import models
from app.crud import record_slug_redirect, resolve_slug_redirect


def test_post_reeslug_redirects_old_slug(client, auth_headers, db_session):
    post = models.Post(title="Rename Me", slug="old-slug", content="x", published=True)
    db_session.add(post)
    db_session.commit()

    resp = client.get("/api/posts/old-slug")
    assert resp.status_code == 200
    assert "x-redirect-to" not in resp.headers

    # Re-slug via the admin editor path.
    update = client.put(
        f"/api/admin/posts/{post.id}",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"slug": "new-slug"},
    )
    assert update.status_code == 200

    # Old URL: 404 contract preserved, but with the canonical target header.
    old = client.get("/api/posts/old-slug")
    assert old.status_code == 404
    assert old.headers.get("x-redirect-to") == "/posts/new-slug"
    # New URL serves the post.
    fresh = client.get("/api/posts/new-slug")
    assert fresh.status_code == 200
    assert fresh.json()["slug"] == "new-slug"


def test_series_reeslug_redirects_old_slug(client, auth_headers, db_session):
    series = models.Series(title="Old Series", slug="old-series")
    db_session.add(series)
    db_session.commit()

    update = client.put(
        f"/api/series/{series.id}",
        headers={**auth_headers, "Content-Type": "application/json"},
        json={"slug": "new-series"},
    )
    assert update.status_code == 200

    old = client.get("/api/series/old-series")
    assert old.status_code == 404
    assert old.headers.get("x-redirect-to") == "/series/new-series"


def test_page_reeslug_redirects_old_slug(client, auth_headers):
    created = client.post(
        "/api/admin/pages",
        json={"slug": "old-page", "title": "Privacy", "content": "x", "published": True},
        headers=auth_headers,
    )
    assert created.status_code == 201
    pid = created.json()["id"]

    update = client.patch(f"/api/admin/pages/{pid}", json={"slug": "new-page"}, headers=auth_headers)
    assert update.status_code == 200

    old = client.get("/api/pages/old-page")
    assert old.status_code == 404
    assert old.headers.get("x-redirect-to") == "/pages/new-page"
    assert client.get("/api/pages/new-page").status_code == 200


def test_unknown_slug_has_no_redirect_header(client):
    resp = client.get("/api/posts/never-existed")
    assert resp.status_code == 404
    assert "x-redirect-to" not in resp.headers


def test_chain_collapses_when_a_slug_moves_again(db_session):
    """A->B then B->C must resolve A->C in one hop — old links never chain."""
    record_slug_redirect(db_session, "post", "a", "b")
    db_session.commit()
    assert resolve_slug_redirect(db_session, "post", "a") == "b"

    record_slug_redirect(db_session, "post", "b", "c")
    db_session.commit()
    assert resolve_slug_redirect(db_session, "post", "a") == "c"
    assert resolve_slug_redirect(db_session, "post", "b") == "c"


def test_same_slug_is_noop(db_session):
    record_slug_redirect(db_session, "post", "s", "s")
    db_session.commit()
    assert resolve_slug_redirect(db_session, "post", "s") is None


def test_rename_back_back_to_origin_does_not_self_loop(db_session):
    """A->B then B->A must not leave an A->A row that would loop a browser.

    The A->B row is retargeted to A->A when B is renamed back to A; the
    retarget is skipped, and even a surviving self-loop row resolves to None.
    """
    record_slug_redirect(db_session, "post", "a", "b")
    db_session.commit()
    record_slug_redirect(db_session, "post", "b", "a")
    db_session.commit()
    # Both resolve forward (or nowhere) — never back at themselves.
    assert resolve_slug_redirect(db_session, "post", "b") == "a"
    assert resolve_slug_redirect(db_session, "post", "a") is None
