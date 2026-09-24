"""Post author attribution contract tests (DEC-359, TASK-405).

Posts carry an ``author_id`` (defaulting to the writing admin), admins get a
public pen name (``display_name``) deliberately distinct from their login
username, and a per-author archive exposes a writer's published posts. No-oracle
posture: the login username never appears in any public payload, and an author
without a pen name answers 404 exactly like an unknown id — the endpoint cannot
enumerate admins or reveal which usernames exist (admin login is no-oracle).

Key properties:
- POST /api/admin/posts defaults ``author_id`` to the authenticated admin;
  an explicit ``author_id`` overrides it. PATCH /api/admin/users/{id} (and user
  creation) set/clear the public pen name (superuser-only).
- Post/PostList serialize ``author`` as {id, display_name}; a User with no pen
  name serializes as no author; the username string never appears.
- GET /api/authors/{id}/posts lists a public author's published posts
  (paginated, newest-first), excluding drafts; unknown ids and pen-name-less
  admins both 404.
"""

import json
from uuid import uuid4

from app import auth


def _admin_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client, username: str, password: str) -> str:
    r = client.post("/api/admin/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _set_pen_name(client, headers, user_id: int, display_name: str | None) -> None:
    r = client.patch(f"/api/admin/users/{user_id}", headers=headers, json={"display_name": display_name})
    assert r.status_code == 200, r.text


def _create_post(client, headers, *, slug: str | None = None, published: bool = True, **extra) -> int:
    r = client.post(
        "/api/admin/posts",
        headers=headers,
        json={
            "title": "Author attribution post",
            "slug": slug or f"author-{uuid4().hex[:10]}",
            "content": "# Hi from the author",
            "published": published,
            **extra,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _no_username_leak(payload: dict) -> None:
    """The login username is an admin credential first half — it must never
    appear in any public/reader-facing payload."""
    assert "username" not in json.dumps(payload)


def test_admin_create_defaults_author_to_writing_admin(client, admin_token, admin_user, db_session):
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Riki the Writer")
    pid = _create_post(client, _admin_headers(admin_token))

    detail = client.get(f"/api/posts/{pid}").json()
    assert detail["author"] == {"id": admin_user.id, "display_name": "Riki the Writer", "avatar_url": None}
    _no_username_leak(detail)

    row = db_session.query(auth.User).filter(auth.User.id == admin_user.id).one()
    assert row.display_name == "Riki the Writer"


def test_admin_create_route_also_authors_to_writing_admin(client, admin_token, admin_user):
    # The second admin-create route (POST /api/posts) must default author_id to
    # the writing admin too — a post created there with no explicit author
    # would otherwise never get a byline (round-343 deep-dive).
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Route Writer")
    r = client.post(
        "/api/posts",
        headers=_admin_headers(admin_token),
        json={
            "title": "Route-authored post",
            "slug": f"route-author-{uuid4().hex[:10]}",
            "content": "# hi",
            "published": True,
        },
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    detail = client.get(f"/api/posts/{pid}").json()
    assert detail["author"] == {"id": admin_user.id, "display_name": "Route Writer", "avatar_url": None}
    _no_username_leak(detail)


def test_editor_created_post_is_authored_by_editor(client, db_session):
    editor = auth.User(
        username=f"ed{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name="Editor Person",
    )
    db_session.add(editor)
    db_session.flush()
    editor_token = _login(client, editor.username, "editorpass123")

    pid = _create_post(client, _admin_headers(editor_token))
    detail = client.get(f"/api/posts/{pid}").json()
    assert detail["author"] == {"id": editor.id, "display_name": "Editor Person", "avatar_url": None}
    _no_username_leak(detail)


def test_explicit_author_id_overrides_writer(client, admin_token, db_session):
    editor = auth.User(
        username=f"o{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name="Ghostwriter",
    )
    db_session.add(editor)
    db_session.flush()

    pid = _create_post(
        client,
        _admin_headers(admin_token),
        author_id=editor.id,
    )
    detail = client.get(f"/api/posts/{pid}").json()
    assert detail["author"] == {"id": editor.id, "display_name": "Ghostwriter", "avatar_url": None}


def test_post_without_pen_name_has_no_author(client, admin_token):
    # No pen name set on the writing admin: the byline must be absent entirely
    # (never an empty-named author, never the username).
    pid = _create_post(client, _admin_headers(admin_token))
    detail = client.get(f"/api/posts/{pid}").json()
    assert detail["author"] is None
    _no_username_leak(detail)


def test_public_list_includes_author_without_username(client, admin_token, admin_user):
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "List Writer")
    _create_post(client, _admin_headers(admin_token), slug=f"list-{uuid4().hex[:8]}")

    listing = client.get("/api/posts?limit=50").json()
    authored = [p for p in listing["items"] if p["author"]]
    assert authored, "expected at least one authored post in the list"
    assert all({"id", "display_name", "avatar_url"} == set(a["author"]) for a in authored)
    _no_username_leak(listing)


def test_admin_user_patch_sets_and_clears_pen_name(client, admin_token, admin_user):
    headers = _admin_headers(admin_token)
    _set_pen_name(client, headers, admin_user.id, "Byline Here")
    r = client.get("/api/admin/users", headers=headers)
    me = next(u for u in r.json() if u["id"] == admin_user.id)
    assert me["display_name"] == "Byline Here"

    # Clearing (explicit null) returns the author to no public identity.
    _set_pen_name(client, headers, admin_user.id, None)
    r = client.get("/api/admin/users", headers=headers)
    me = next(u for u in r.json() if u["id"] == admin_user.id)
    assert me["display_name"] is None


def _set_bio(client, headers, user_id: int, bio: str | None) -> None:
    r = client.patch(f"/api/admin/users/{user_id}", headers=headers, json={"bio": bio})
    assert r.status_code == 200, r.text


def test_admin_user_patch_invalidates_public_caches(client, admin_token, admin_user, monkeypatch):
    """The pen-name/bio PATCH changes AuthorBrief fields rendered from cached
    objects (post lists, series detail, RSS/Atom posts feed) — the write must
    invalidate those caches, not wait out the TTL (ISS-607/TASK-529)."""
    from app.routers import admin as admin_module

    calls = []
    monkeypatch.setattr(admin_module, "clear_posts_list_cache", lambda: calls.append(1))
    # Seed the caches so "was invalidated" is observable post-write.
    from app.cache import posts_list_cache, series_cache

    posts_list_cache[("seed",)] = {"items": []}
    series_cache["seed"] = {"posts": []}

    headers = _admin_headers(admin_token)
    _set_pen_name(client, headers, admin_user.id, "Cache-Clear Name")
    assert calls, "pen-name PATCH must clear the posts-list/series/feeds caches"
    removed = len(calls)
    posts_list_cache.clear()
    series_cache.clear()

    _set_bio(client, headers, admin_user.id, "A bio.")
    assert len(calls) > removed, "bio PATCH must clear the public caches too"


def test_admin_user_patch_sets_and_clears_bio(client, admin_token, admin_user):
    headers = _admin_headers(admin_token)
    _set_pen_name(client, headers, admin_user.id, "Byline Here")
    _set_bio(client, headers, admin_user.id, "Writes about Rust and distributed systems.")

    r = client.get("/api/admin/users", headers=headers)
    me = next(u for u in r.json() if u["id"] == admin_user.id)
    assert me["bio"] == "Writes about Rust and distributed systems."

    # Clearing (explicit null) removes the bio; the writer stays public.
    _set_bio(client, headers, admin_user.id, None)
    r = client.get("/api/admin/users", headers=headers)
    me = next(u for u in r.json() if u["id"] == admin_user.id)
    assert me["bio"] is None
    assert me["display_name"] == "Byline Here"


def test_admin_user_patch_bio_whitespace_and_boundary(client, admin_token, admin_user):
    headers = _admin_headers(admin_token)
    # Whitespace-only bio folds to None (empty bio = no bio), like the reader
    # profile bio validator (ISS-456-style boundary discipline).
    r = client.patch(f"/api/admin/users/{admin_user.id}", headers=headers, json={"bio": "   "})
    assert r.status_code == 200, r.text
    assert r.json()["bio"] is None
    # Over 500 chars is a 422 (schema boundary, same cap as the reader bio).
    r = client.patch(f"/api/admin/users/{admin_user.id}", headers=headers, json={"bio": "x" * 501})
    assert r.status_code == 422
    r = client.patch(f"/api/admin/users/{admin_user.id}", headers=headers, json={"bio": "x" * 500})
    assert r.status_code == 200
    assert r.json()["bio"] == "x" * 500


def test_admin_user_create_stores_bio(client, admin_token):
    r = client.post(
        "/api/admin/users",
        headers=_admin_headers(admin_token),
        json={
            "username": f"bio{uuid4().hex[:6]}",
            "password": "readerpass123",
            "display_name": "Bio Writer",
            "bio": "Posts weekly long-form essays.",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["bio"] == "Posts weekly long-form essays."


def test_author_archive_envelope_carries_bio(client, admin_token, admin_user):
    # The person-shaped archive envelope introduces the writer (round 357): the
    # "about this writer" bio rides on the envelope's author, NOT on the
    # per-post AuthorBrief (which would bloat every list payload with the same
    # text). The username never leaks.
    headers = _admin_headers(admin_token)
    _set_pen_name(client, headers, admin_user.id, "Bio Archive Writer")
    _set_bio(client, headers, admin_user.id, "Long-form on type systems.")
    _create_post(client, headers, slug=f"bioarch-{uuid4().hex[:8]}")

    body = client.get(f"/api/authors/{admin_user.id}/posts").json()
    assert body["author"]["display_name"] == "Bio Archive Writer"
    assert body["author"]["bio"] == "Long-form on type systems."
    # Per-post author briefs stay slim: no bio repetition on every card.
    assert all("bio" not in p["author"] for p in body["items"])
    _no_username_leak(body)


def test_author_archive_envelope_bio_defaults_none(client, admin_token, admin_user):
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "No Bio Writer")
    body = client.get(f"/api/authors/{admin_user.id}/posts").json()
    assert body["author"]["bio"] is None
    assert "username" not in json.dumps(body)


def test_public_authors_index_carries_bio(client, admin_token, admin_user, db_session):
    headers = _admin_headers(admin_token)
    _set_pen_name(client, headers, admin_user.id, "Index Bio Writer")
    _set_bio(client, headers, admin_user.id, "Design researcher.")
    # A second pen-named writer with no bio: index rows carry the bio
    # independently (null for those without).
    editor = auth.User(
        username=f"ib{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name="Quiet Writer",
    )
    db_session.add(editor)
    db_session.flush()

    rows = client.get("/api/authors").json()
    by_name = {r["display_name"]: r for r in rows}
    assert by_name["Index Bio Writer"]["bio"] == "Design researcher."
    assert by_name["Quiet Writer"]["bio"] is None
    _no_username_leak({"rows": rows})


def test_admin_user_patch_is_superuser_only_and_404_unknown(client, db_session, admin_token):
    editor = auth.User(
        username=f"u{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
    )
    db_session.add(editor)
    db_session.flush()
    editor_token = _login(client, editor.username, "editorpass123")

    # Editors cannot manage users (DEC-054): PATCH /users is superuser-only.
    r = client.patch(f"/api/admin/users/{editor.id}", headers=_admin_headers(editor_token), json={"display_name": "x"})
    assert r.status_code == 403
    # Unknown user -> 404.
    r = client.patch("/api/admin/users/999999", headers=_admin_headers(admin_token), json={"display_name": "x"})
    assert r.status_code == 404


def test_admin_user_create_stores_pen_name(client, admin_token):
    r = client.post(
        "/api/admin/users",
        headers=_admin_headers(admin_token),
        json={"username": f"pn{uuid4().hex[:6]}", "password": "readerpass123", "display_name": "New Pen"},
    )
    assert r.status_code == 200
    assert r.json()["display_name"] == "New Pen"

    # Whitespace-only pen name is rejected as "no public identity" (None), not
    # stored blank (ISS-456-style boundary discipline).
    r = client.post(
        "/api/admin/users",
        headers=_admin_headers(admin_token),
        json={"username": f"pn{uuid4().hex[:6]}", "password": "readerpass123", "display_name": "   "},
    )
    assert r.status_code == 200
    assert r.json()["display_name"] is None


def test_author_archive_returns_published_posts_newest_first(client, admin_token, admin_user):
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Archive Writer")
    published = [
        _create_post(client, _admin_headers(admin_token), slug=f"arch-{uuid4().hex[:8]}"),
        _create_post(client, _admin_headers(admin_token), slug=f"arch-{uuid4().hex[:8]}"),
    ]
    # A draft must never surface on the public archive.
    _create_post(client, _admin_headers(admin_token), slug=f"arch-{uuid4().hex[:8]}", published=False)

    body = client.get(f"/api/authors/{admin_user.id}/posts").json()
    assert [p["id"] for p in body["items"]] == sorted(published, reverse=True)
    assert body["pagination"]["total"] == 2
    assert "username" not in json.dumps(body)
    assert all(p["author"]["display_name"] == "Archive Writer" for p in body["items"])


def test_author_archive_paginates(client, admin_token, admin_user):
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Page Writer")
    for _ in range(3):
        _create_post(client, _admin_headers(admin_token), slug=f"page-{uuid4().hex[:8]}")

    page1 = client.get(f"/api/authors/{admin_user.id}/posts?limit=2&page=1").json()
    page2 = client.get(f"/api/authors/{admin_user.id}/posts?limit=2&page=2").json()
    assert len(page1["items"]) == 2
    assert len(page2["items"]) == 1
    assert page1["pagination"] == {"total": 3, "page": 1, "limit": 2, "total_pages": 2}
    # Newest-first across pages: no overlap, ids disjoint.
    assert not {p["id"] for p in page1["items"]} & {p["id"] for p in page2["items"]}


def test_author_archive_404_for_unknown_or_username_only_admin(client, db_session):
    # Unknown id -> 404.
    assert client.get("/api/authors/999999/posts").status_code == 404
    # An admin with NO pen name has no public presence -> the SAME 404 (no
    # oracle: the endpoint cannot enumerate admins or reveal usernames).
    editor = auth.User(
        username=f"np{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name=None,
    )
    db_session.add(editor)
    db_session.flush()
    assert client.get(f"/api/authors/{editor.id}/posts").status_code == 404


def test_admin_authors_endpoint_lists_pennamed_only_for_any_admin(client, db_session, admin_token):
    # The post editor's author picker: every admin with a pen name, reachable by
    # ANY admin (editor included) — not superuser-only like /users. Pen names
    # are already public on bylines; the login username must not appear here.
    admin = db_session.query(auth.User).filter(auth.User.role == "superuser").first()
    admin.display_name = "Super Pen"
    editor = auth.User(
        username=f"pa{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name="Editor Pen",
    )
    plain = auth.User(
        username=f"np_{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name=None,
    )
    db_session.add_all([editor, plain])
    db_session.flush()

    # A superuser sees all pen-named admins.
    r = client.get("/api/admin/authors", headers=_admin_headers(admin_token))
    assert r.status_code == 200
    names = {u["display_name"] for u in r.json()}
    assert names == {"Super Pen", "Editor Pen"}
    assert "username" not in json.dumps(r.json())

    # An editor can reach the same endpoint (that is the point — editors must
    # be able to attribute a post to another public writer).
    editor_token = _login(client, editor.username, "editorpass123")
    r = client.get("/api/admin/authors", headers=_admin_headers(editor_token))
    assert r.status_code == 200
    assert {u["display_name"] for u in r.json()} == {"Super Pen", "Editor Pen"}


def test_admin_update_post_reassigns_author(client, admin_token, admin_user, db_session):
    # The editor's author picker: PUT /posts/{id} with a new author_id moves the
    # post to another writer; the admin detail reflects it.
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Original Writer")
    editor = auth.User(
        username=f"re{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name="Reassigned Writer",
    )
    db_session.add(editor)
    db_session.flush()

    pid = _create_post(client, _admin_headers(admin_token))
    # Admin detail exposes author_id for the picker's pre-selection.
    detail = client.get(f"/api/admin/posts/{pid}", headers=_admin_headers(admin_token)).json()
    assert detail["author_id"] == admin_user.id

    r = client.put(
        f"/api/admin/posts/{pid}",
        headers=_admin_headers(admin_token),
        json={"author_id": editor.id},
    )
    assert r.status_code == 200, r.text

    public = client.get(f"/api/posts/{pid}").json()
    assert public["author"] == {"id": editor.id, "display_name": "Reassigned Writer", "avatar_url": None}
    detail = client.get(f"/api/admin/posts/{pid}", headers=_admin_headers(admin_token)).json()
    assert detail["author_id"] == editor.id
    _no_username_leak(public)


def test_author_rss_feed_scopes_to_one_writer(client, admin_token, admin_user, db_session):
    # /rss/authors/{id}.xml delivers ONLY that writer's published posts
    # (round 345): each pen-named writer gets their own scoped feed, no
    # cross-writer bleed and no username in the payload.
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Feed Writer")
    other = auth.User(
        username=f"fw{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name="Other Feed Writer",
    )
    db_session.add(other)
    db_session.flush()
    other_token = _login(client, other.username, "editorpass123")

    _create_post(client, _admin_headers(admin_token), slug=f"mine-feed-{uuid4().hex[:8]}")
    _create_post(client, _admin_headers(other_token), slug=f"theirs-feed-{uuid4().hex[:8]}")

    r = client.get(f"/rss/authors/{admin_user.id}.xml")
    assert r.status_code == 200
    assert "Feed Writer" in r.text
    assert "mine-feed-" in r.text
    assert "theirs-feed-" not in r.text
    assert "username" not in r.text

    r2 = client.get(f"/rss/authors/{other.id}.xml")
    assert r2.status_code == 200
    assert "Other Feed Writer" in r2.text
    assert "theirs-feed-" in r2.text
    assert "mine-feed-" not in r2.text


def test_author_rss_404_for_unknown_or_username_only_author(client, db_session):
    # Unknown id -> 404 (matches the archive endpoint's no-oracle boundary).
    assert client.get("/rss/authors/999999.xml").status_code == 404
    editor = auth.User(
        username=f"nf{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name=None,
    )
    db_session.add(editor)
    db_session.flush()
    assert client.get(f"/rss/authors/{editor.id}.xml").status_code == 404


def test_public_authors_index_lists_pennamed_with_counts(client, admin_token, admin_user, db_session):
    # GET /api/authors (writer discovery, round 346): every pen-named admin
    # with their published-post count; never the username; a pen-name-less
    # admin stays off the list.
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Index Writer")
    _create_post(client, _admin_headers(admin_token))
    _create_post(client, _admin_headers(admin_token))
    other = auth.User(
        username=f"wi{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name="Unpublished Writer",
    )
    plain = auth.User(
        username=f"pwi{uuid4().hex[:6]}",
        password=auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
        display_name=None,
    )
    db_session.add_all([other, plain])
    db_session.flush()

    r = client.get("/api/authors")
    assert r.status_code == 200
    by_id = {a["id"]: a for a in r.json()}
    assert by_id[admin_user.id]["display_name"] == "Index Writer"
    assert by_id[admin_user.id]["post_count"] == 2
    assert by_id[other.id]["post_count"] == 0
    assert other.id in by_id  # pen-named: listed even with nothing published
    assert plain.id not in by_id  # no pen name: no public presence
    assert "username" not in json.dumps(r.json())


def test_author_archive_envelope_identifies_author_even_when_empty(client, admin_token, admin_user):
    # The archive page must be able to title itself by pen name even before the
    # writer has published anything — the author envelope rides on the (empty)
    # list rather than being derived from a post that may not exist yet.
    _set_pen_name(client, _admin_headers(admin_token), admin_user.id, "Nobody Yet")
    body = client.get(f"/api/authors/{admin_user.id}/posts").json()
    assert body["items"] == []
    # The envelope is AuthorArchive (round 357): bio rides here (null until a
    # superuser writes one) rather than on per-post AuthorBrief.
    assert body["author"] == {"id": admin_user.id, "display_name": "Nobody Yet", "bio": None, "avatar_url": None}
    _no_username_leak(body)
