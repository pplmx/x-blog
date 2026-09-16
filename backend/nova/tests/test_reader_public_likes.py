"""Opt-in public liked-posts profile tab contract tests (round 360, DEC-393).

Round 359 made a reader's likes durable cloud rows (reader_post_likes); this
suite pins the new public surface around them: a reader who flips
public_likes on /account publishes a profile "Liked posts" tab
(GET /api/readers/{id}/likes) that anyone can browse, still scoped to
publicly-visible posts (same non-leak invariant as /me/likes). The privacy
posture is unchanged by default: the flag defaults OFF, and the endpoint 404s
for BOTH unknown readers AND readers who chose not to publish — one
indistinguishable answer, so the surface is not an oracle for "does this
reader exist" or "what do they like" (matching the profile router's non-leak
stance). The flag also joins /account PATCH, the /me profile, the public
profile envelope, and the portable data export.
"""

LIKES = "/api/reader/me/likes"
PUBLIC_LIKES = "/api/readers/{reader_id}/likes"
ME = "/api/reader/me"
PROFILE = "/api/readers/{reader_id}"
EXPORT = "/api/reader/me/export"

_EMAIL_COUNTER = 0


def _register(client, email=None, password="readerpass123"):
    """Register a fresh reader; returns the parsed login JSON. Each call uses a
    unique email so tests can register several readers without 409s."""
    global _EMAIL_COUNTER
    _EMAIL_COUNTER += 1
    email = email or f"pub-liker-{_EMAIL_COUNTER}@example.com"
    resp = client.post("/api/reader/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _reader(client, email=None):
    """Register one reader and return (access_token, reader_id)."""
    reg = _register(client, email=email)
    return reg["access_token"], reg["reader"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _create_post(db_session, *, published=True, draft=False, **overrides):
    """Create a post directly via crud (bypasses the admin API for brevity)."""
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    payload = {
        "title": "Public-like post",
        "slug": f"public-like-{_slug_counter}",
        "content": "# Hello\n\nWorld",
        "published": False if draft else published,
        **overrides,
    }
    return create_post(db_session, PostCreate(**payload))


class TestGating:
    def test_unknown_reader_404(self, client):
        resp = client.get(PUBLIC_LIKES.format(reader_id=999_999))
        assert resp.status_code == 404

    def test_opt_out_404_even_with_likes(self, client, db_session):
        token, reader_id = _reader(client)
        post = _create_post(db_session)
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        # Default flag is OFF: the public endpoint must still answer 404 (the
        # profile would otherwise be an oracle for what the silent reader likes).
        assert client.get(PUBLIC_LIKES.format(reader_id=reader_id)).status_code == 404

    def test_public_profile_exposes_flag_defaults_false(self, client):
        _token, reader_id = _reader(client)
        resp = client.get(PROFILE.format(reader_id=reader_id))
        assert resp.status_code == 200
        assert resp.json()["profile"]["public_likes"] is False

    def test_public_likes_needs_no_token(self, client, db_session):
        # The whole point: an anonymous visitor can browse the published tab.
        token, reader_id = _reader(client)
        post = _create_post(db_session)
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        client.patch(ME, json={"public_likes": True}, headers=_auth(token))
        assert client.get(PUBLIC_LIKES.format(reader_id=reader_id)).status_code == 200


class TestOptIn:
    def test_patch_sets_flag_and_public_endpoint_lists(self, client, db_session):
        token, reader_id = _reader(client)
        post = _create_post(db_session, title="Public like", slug="public-like-post")
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201

        # Flip the opt-in via PATCH /me; the response and /me both reflect it.
        resp = client.patch(ME, json={"public_likes": True}, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["public_likes"] is True
        assert client.get(ME, headers=_auth(token)).json()["public_likes"] is True
        # The public profile envelope carries the flag so the page can render
        # the tab only for opt-ins.
        assert client.get(PROFILE.format(reader_id=reader_id)).json()["profile"]["public_likes"] is True

        # The public endpoint now lists the liked post (PostListResponse shape).
        listed = client.get(PUBLIC_LIKES.format(reader_id=reader_id))
        assert listed.status_code == 200
        body = listed.json()
        assert body["pagination"]["total"] == 1
        assert body["pagination"]["total_pages"] == 1
        assert body["items"][0]["id"] == post.id
        assert body["items"][0]["title"] == "Public like"
        assert body["items"][0]["slug"] == "public-like-post"

    def test_opt_out_removes_the_tab_again(self, client, db_session):
        token, reader_id = _reader(client)
        post = _create_post(db_session)
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        client.patch(ME, json={"public_likes": True}, headers=_auth(token))
        assert client.get(PUBLIC_LIKES.format(reader_id=reader_id)).status_code == 200
        client.patch(ME, json={"public_likes": False}, headers=_auth(token))
        assert client.get(PUBLIC_LIKES.format(reader_id=reader_id)).status_code == 404

    def test_flag_patch_does_not_disturb_other_fields(self, client):
        token, _reader_id = _reader(client)
        # Set a display name and bio, then flip ONLY the flag: neither must be
        # cleared or altered (exclude_unset discipline on the PATCH).
        client.patch(
            ME,
            json={"display_name": "Kept", "bio": "still here"},
            headers=_auth(token),
        )
        resp = client.patch(ME, json={"public_likes": True}, headers=_auth(token))
        assert resp.status_code == 200
        me = client.get(ME, headers=_auth(token)).json()
        assert me["display_name"] == "Kept"
        assert me["bio"] == "still here"
        assert me["public_likes"] is True


class TestVisibility:
    def test_only_publicly_visible_posts(self, client, db_session):
        token, reader_id = _reader(client)
        good = _create_post(db_session, title="Good", slug="public-good")
        # A draft cannot be liked at all (no draft leak on a write or read).
        draft_id = _create_post(db_session, draft=True).id
        assert client.post(f"{LIKES}/{draft_id}", headers=_auth(token)).status_code == 404
        # The published post IS liked; only it may be published publicly.
        assert client.post(f"{LIKES}/{good.id}", headers=_auth(token)).status_code == 201
        client.patch(ME, json={"public_likes": True}, headers=_auth(token))
        listed = client.get(PUBLIC_LIKES.format(reader_id=reader_id)).json()
        assert [p["id"] for p in listed["items"]] == [good.id]

    def test_unpublishing_hides_the_post_from_the_public_list(self, client, db_session):
        token, reader_id = _reader(client)
        post = _create_post(db_session, title="Gone", slug="public-gone")
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        client.patch(ME, json={"public_likes": True}, headers=_auth(token))
        assert client.get(PUBLIC_LIKES.format(reader_id=reader_id)).json()["pagination"]["total"] == 1
        # Un-publish: the public list must never leak it (row is kept, not shown).
        post.published = False
        db_session.commit()
        assert client.get(PUBLIC_LIKES.format(reader_id=reader_id)).json()["pagination"]["total"] == 0


class TestExport:
    def test_export_includes_the_flag_and_liked_posts(self, client, db_session):
        token, _reader_id = _reader(client)
        post = _create_post(db_session, title="Exported like", slug="exported-like-post")
        assert client.post(f"{LIKES}/{post.id}", headers=_auth(token)).status_code == 201
        client.patch(ME, json={"public_likes": True}, headers=_auth(token))
        bundle = client.get(EXPORT, headers=_auth(token))
        assert bundle.status_code == 200
        body = bundle.json()
        assert body["account"]["public_likes"] is True
        assert any(like["post_id"] == post.id for like in body["likes"])
        assert any(like["slug"] == "exported-like-post" for like in body["likes"])
