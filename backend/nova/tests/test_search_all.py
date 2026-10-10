"""Combined search (series / public static pages / author archives) tests.

``/api/search/all`` broadens the blog search beyond posts (and comments, which
live on /api/search/comments) so a term that lives only in a series title, a
static page body, or an author pen name still lands the reader somewhere. Each
hit carries a ``type`` tag and a deep-linkable ``path``.

Public-visibility is the crux (no oracle): posts keep the published +
scheduled-passthrough gate (no draft/scheduled leak), pages are ``published``
only, series are all public (they have no draft state), and authors are
pen-named admins only — a username-only admin's login username is never
indexed. Matching is the same CJK-aware, dialect-parity substring AND the post
search uses (DEC-084), so partial Chinese terms match on SQLite and Postgres
alike.
"""


async def _create_series(client, headers, slug, title, description=None):
    resp = await client.post(
        "/api/series",
        json={"slug": slug, "title": title, "description": description},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_page(client, headers, slug, title, content, published=False):
    resp = await client.post(
        "/api/admin/pages",
        json={"slug": slug, "title": title, "content": content, "published": published},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _set_pen_name(client, headers, user_id, display_name):
    resp = await client.patch(f"/api/admin/users/{user_id}", json={"display_name": display_name}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _search_all(client, q, **params):
    resp = await client.get("/api/search/all", params={"q": q, **params})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _only(data, type_):
    return [i for i in data["items"] if i["type"] == type_]


class TestCombinedSearch:
    async def test_series_hit_deep_links(self, client, auth_headers):
        await _create_series(
            client,
            auth_headers,
            "quantum-fables",
            "Quantum Fables",
            description="A journal about the series-secret-xyz phenomenon.",
        )
        data = await _search_all(client, "series-secret-xyz")
        series = _only(data, "series")
        assert len(series) == 1
        assert series[0]["title"] == "Quantum Fables"
        assert series[0]["slug"] == "quantum-fables"
        assert series[0]["path"] == "/series/quantum-fables"

    async def test_published_page_hit_deep_links(self, client, auth_headers):
        await _create_page(
            client,
            auth_headers,
            "privacy",
            "Privacy Policy",
            content="We care deeply about page-marker-abc.",
            published=True,
        )
        data = await _search_all(client, "page-marker-abc")
        pages = _only(data, "page")
        assert len(pages) == 1
        assert pages[0]["title"] == "Privacy Policy"
        assert pages[0]["slug"] == "privacy"
        assert pages[0]["path"] == "/pages/privacy"

    async def test_unpublished_page_never_leaks(self, client, auth_headers):
        await _create_page(
            client, auth_headers, "draft-page", "Draft Page", content="secret-draft-marker", published=False
        )
        data = await _search_all(client, "secret-draft-marker")
        assert data["pagination"]["total"] == 0
        assert all(i["type"] != "page" for i in data["items"])

    async def test_author_pen_name_hit_deep_links(self, client, auth_headers, admin_user):
        await _set_pen_name(client, auth_headers, admin_user.id, "Riki the Weaver")
        data = await _search_all(client, "Weaver")
        authors = _only(data, "author")
        assert len(authors) == 1
        assert authors[0]["title"] == "Riki the Weaver"
        assert authors[0]["path"] == f"/authors/{admin_user.id}"
        assert authors[0]["slug"] is None

    async def test_username_only_admin_not_indexed(self, client, auth_headers):
        # display_name is None → the login username must never be searchable
        # (an author with no pen name has no public presence).
        data = await _search_all(client, "testadmin")
        assert all(i["type"] != "author" for i in data["items"])

    async def test_posts_still_rank_in_combined(self, client, auth_headers):
        resp = await client.post(
            "/api/posts",
            json={
                "title": "Combined Post",
                "slug": "combined-post",
                "content": "body mentions combo-marker-991",
                "published": True,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = await _search_all(client, "combo-marker-991")
        posts = _only(data, "post")
        assert any(p["slug"] == "combined-post" and p["path"] == "/posts/combined-post" for p in posts)

    async def test_draft_post_never_leaks(self, client, auth_headers):
        resp = await client.post(
            "/api/posts",
            json={
                "title": "Draft Opus",
                "slug": "draft-opus",
                "content": "unreleased draft-marker-77",
                "published": False,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = await _search_all(client, "draft-marker-77")
        assert data["pagination"]["total"] == 0

    async def test_cjk_series_title_partial_match(self, client, auth_headers):
        await _create_series(
            client, auth_headers, "zh-series", "类型体系漫谈", description="讲的是类型检查与编译器设计。"
        )
        data = await _search_all(client, "类型")
        series = _only(data, "series")
        assert any(i["title"] == "类型体系漫谈" for i in series)

    async def test_cjk_page_content_match(self, client, auth_headers):
        await _create_page(
            client, auth_headers, "zh-page", "隐私政策", content="我们存储评论系统相关数据。", published=True
        )
        data = await _search_all(client, "评论系统")
        pages = _only(data, "page")
        assert any(i["title"] == "隐私政策" for i in pages)

    async def test_cjk_author_pen_name_match(self, client, auth_headers, admin_user):
        await _set_pen_name(client, auth_headers, admin_user.id, "评论家老张")
        data = await _search_all(client, "老张")
        authors = _only(data, "author")
        assert any(i["title"] == "评论家老张" for i in authors)

    async def test_empty_result(self, client, auth_headers):
        data = await _search_all(client, "no-such-term-zzz-xyz")
        assert data["items"] == []
        assert data["pagination"]["total"] == 0
        assert data["pagination"]["total_pages"] == 0

    async def test_blank_query_is_422(self, client):
        # Same non-blank guard as /api/search: a whitespace-only q must never
        # degrade into an ILIKE '% %' full scan (round-296).
        assert (await client.get("/api/search/all", params={"q": "   "})).status_code == 422

    async def test_pagination_across_pages(self, client, auth_headers):
        for i in range(3):
            await _create_page(
                client, auth_headers, f"pg{i}", f"Page {i}", content=f"shared-pg-token-{i}", published=True
            )
        data = await _search_all(client, "shared-pg-token", limit=2)
        assert data["pagination"]["total"] == 3
        assert data["pagination"]["total_pages"] == 2
        assert len(data["items"]) == 2
        page_two = await _search_all(client, "shared-pg-token", limit=2, page=2)
        assert len(page_two["items"]) == 1
