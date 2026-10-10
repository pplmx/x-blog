"""Reader liked-posts recall-search tests (DEC-413, TASK-432).

A signed-in reader can filter their liked posts on /me/likes by a term
(case-insensitive) matching the post title or excerpt, so a reader with a long
"posts I appreciated" list can recall a specific one. The filter stays scoped
to the caller's own likes; LIKE metacharacters are escaped so % and _ match
literally (round-366 precedent; same pattern as history recall-search DEC-148).
"""

LIKES = "/api/reader/me/likes"


async def _register(client, email="likesrch@example.com"):
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123"},
    )


async def _token(client, **kw):
    return (await _register(client, **kw)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


async def _create_post(db_session, *, title="Likeable post", excerpt=None, content="# Hello\n\nWorld"):
    """Create a published post directly via crud (bypasses the admin API)."""
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return await create_post(
        db_session,
        PostCreate(title=title, slug=f"likesrch-{_slug_counter}", content=content, excerpt=excerpt, published=True),
    )


async def _like(client, token, post_id):
    assert (await client.post(f"{LIKES}/{post_id}", headers=_auth(token))).status_code == 201


class TestLikesSearch:
    async def test_q_matches_title(self, client, db_session):
        token = await _token(client)
        rust = await _create_post(db_session, title="Rust Borrow Checker")
        await _create_post(db_session, title="Baking Basics")
        await _like(client, token, rust.id)

        data = (await client.get(LIKES, headers=_auth(token), params={"q": "borrow"})).json()
        assert data["pagination"]["total"] == 1
        assert data["items"][0]["title"] == "Rust Borrow Checker"

    async def test_q_matches_excerpt(self, client, db_session):
        token = await _token(client)
        p = await _create_post(db_session, excerpt="deep dive into async runtimes")
        await _like(client, token, p.id)

        data = (await client.get(LIKES, headers=_auth(token), params={"q": "async"})).json()
        assert data["pagination"]["total"] == 1
        assert data["items"][0]["id"] == p.id

    async def test_q_is_case_insensitive(self, client, db_session):
        token = await _token(client)
        p = await _create_post(db_session, title="Hello World")
        await _like(client, token, p.id)

        data = (await client.get(LIKES, headers=_auth(token), params={"q": "HELLO"})).json()
        assert data["pagination"]["total"] == 1

    async def test_blank_q_is_ignored(self, client, db_session):
        token = await _token(client)
        p1 = await _create_post(db_session, title="first liked")
        p2 = await _create_post(db_session, title="second liked")
        await _like(client, token, p1.id)
        await _like(client, token, p2.id)

        data = (await client.get(LIKES, headers=_auth(token), params={"q": "   "})).json()
        assert data["pagination"]["total"] == 2

    async def test_no_match_returns_empty(self, client, db_session):
        token = await _token(client)
        p = await _create_post(db_session)
        await _like(client, token, p.id)

        data = (await client.get(LIKES, headers=_auth(token), params={"q": "zzz-no-such"})).json()
        assert data["pagination"]["total"] == 0
        assert data["items"] == []

    async def test_q_escapes_literal_percent_and_underscore(self, client, db_session):
        """Round-366 precedent: % and _ must match literally, not as wildcards."""
        token = await _token(client)
        p1 = await _create_post(db_session, title="sold at 100% off")
        p2 = await _create_post(db_session, title="use snake_case names")
        await _like(client, token, p1.id)
        await _like(client, token, p2.id)

        pct = (await client.get(LIKES, headers=_auth(token), params={"q": "100%"})).json()
        assert pct["pagination"]["total"] == 1
        assert pct["items"][0]["title"] == "sold at 100% off"

        us = (await client.get(LIKES, headers=_auth(token), params={"q": "_"})).json()
        assert us["pagination"]["total"] == 1
        assert us["items"][0]["title"] == "use snake_case names"

    async def test_q_scoped_to_own_likes(self, client, db_session):
        token_a = await _token(client, email="alicel@example.com")
        token_b = await _token(client, email="bobl@example.com")
        shared = await _create_post(db_session, title="shared keyword post")
        await _like(client, token_a, shared.id)
        await _like(client, token_b, shared.id)

        data = (await client.get(LIKES, headers=_auth(token_a), params={"q": "shared"})).json()
        assert data["pagination"]["total"] == 1
        assert data["items"][0]["id"] == shared.id

    async def test_q_total_and_pagination_reflect_filter(self, client, db_session):
        token = await _token(client)
        ids = []
        for i in range(3):
            p = await _create_post(db_session, title=f"needle {i}")
            await _like(client, token, p.id)
            ids.append(p.id)
        unliked = await _create_post(db_session, title="other topic")
        await _like(client, token, unliked.id)

        data = (await client.get(LIKES, headers=_auth(token), params={"q": "needle", "page": 2, "limit": 2})).json()
        assert data["pagination"]["total"] == 3
        assert len(data["items"]) == 1
        assert data["pagination"]["page"] == 2
        assert data["pagination"]["total_pages"] == 2

    async def test_overlong_q_is_422(self, client, db_session):
        token = await _token(client)
        resp = await client.get(LIKES, headers=_auth(token), params={"q": "x" * 201})
        assert resp.status_code == 422

    async def test_search_does_not_leak_unpublished_post(self, client, db_session):
        """Visibility gate holds under q: a liked post that turned draft must not
        match — the filter must compose with the public-visibility WHERE."""
        from app.crud import update_post
        from app.schemas import PostUpdate

        token = await _token(client)
        p = await _create_post(db_session, title="secret draft keyword")
        await _like(client, token, p.id)
        # Un-publish it directly (like the reader trails invariant).
        await update_post(db_session, p.id, PostUpdate(published=False))

        data = (await client.get(LIKES, headers=_auth(token), params={"q": "secret"})).json()
        assert data["pagination"]["total"] == 0
