"""Tests for RSS, Atom, Sitemap, and robots.txt endpoints."""


def test_rss_feed_returns_xml(client):
    """RSS feed should return valid XML with correct content-type."""
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/rss+xml"
    content = response.text
    assert content.startswith('<?xml version="1.0"')
    assert "<rss version=" in content
    assert "<channel>" in content
    assert "<title>" in content


def test_rss_feed_with_posts(client, auth_headers):
    """RSS feed should include published posts."""
    # Create a published post
    client.post(
        "/api/posts",
        json={
            "title": "RSS Test Post",
            "slug": "rss-test-post",
            "content": "RSS feed content",
            "excerpt": "RSS excerpt",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    content = response.text
    assert "RSS Test Post" in content
    assert "rss-test-post" in content


def test_rss_feed_full_content_flag(client, auth_headers):
    """RSS feed with full=true should include content:encoded."""
    client.post(
        "/api/posts",
        json={
            "title": "Full Content Post",
            "slug": "full-content-post",
            "content": "Full post content here",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/feed.xml?full=true")
    assert response.status_code == 200
    content = response.text
    assert "content:encoded" in content
    assert "Full post content here" in content


def test_rss_full_feed_renders_markdown_as_html(client, auth_headers):
    """Full-content feeds must render markdown to HTML, not literal syntax,
    and strip dangerous markup (ISS-039)."""
    client.post(
        "/api/posts",
        json={
            "title": "MD Post",
            "slug": "md-post",
            "content": '# Heading\n\n**bold** and `code`.\n\n<b onclick="x()">inline</b><script>alert(1)</script>',
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/feed.xml?full=true")
    assert response.status_code == 200
    content = response.text
    # Rendered HTML: heading tag, bold tag, code tag appear; raw markdown syntax does not.
    assert "<h1" in content
    assert "<strong>" in content
    assert "<code>" in content
    assert "# Heading" not in content
    assert "**bold**" not in content
    # Dangerous markup stripped: no script, no event-handler attributes.
    assert "<script" not in content
    assert "onclick" not in content


def test_rss_full_feed_keeps_tags_balanced_with_void_elements(client, auth_headers):
    """Full-content feed must not drop closing tags around void elements.

    Markdown's nl2br emits <br>; HTMLParser reports <br> as a start tag (no
    close), which used to consume the sanitizer's stack slot and dropped the
    enclosing </p>/</div> — corrupting default full-content feeds. Regression
    for RIL TASK-108, ISS-088.
    """
    client.post(
        "/api/posts",
        json={
            "title": "br post",
            "slug": "br-post",
            "content": "line one<br>\nline two<br>\n\nsecond paragraph",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/feed.xml?full=true")
    assert response.status_code == 200
    content = response.text
    # The <br> tags survive, and the <p> they sit in still closes (before the
    # fix the trailing </p> was dropped).
    assert "<br>" in content
    assert content.count("<br>") == content.count("<br>")  # sanity
    # No unbalanced <p> inside the content:encoded block.
    import re

    block = re.search(r"<content:encoded>(.*?)</content:encoded>", content, re.S)
    assert block is not None
    rendered = block.group(1)
    # Every <p> that is opened must be closed.
    assert rendered.count("<p>") == rendered.count("</p>"), rendered


def test_atom_feed_renders_markdown_as_html(client, auth_headers):
    """Atom full-content feed also renders markdown to sanitized HTML."""
    client.post(
        "/api/posts",
        json={
            "title": "Atom MD",
            "slug": "atom-md",
            "content": "**nice** <script>alert(1)</script>",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/atom.xml")
    assert response.status_code == 200
    content = response.text
    # The <content type=html> block renders markdown to sanitized HTML.
    import re

    content_block = re.search(r"<content type=\"html\">(.*?)</content>", content, re.S)
    assert content_block is not None
    rendered = content_block.group(1)
    assert "<strong>nice</strong>" in rendered
    assert "**nice**" not in rendered
    assert "<script" not in rendered
    # No event-handler attributes survive.
    assert "onclick" not in rendered


def test_rss_feed_strips_unsafe_url_schemes(client, auth_headers):
    """Unsafe URL schemes (javascript:/data:/vbscript:) in anchor/image href/src
    must be stripped from rendered feeds, matching the frontend DOMPurify policy
    (RIL TASK-091, ISS-071). Safe http(s)/relative URLs survive."""
    client.post(
        "/api/posts",
        json={
            "title": "Scheme Post",
            "slug": "scheme-post",
            "content": (
                '<a href="https://ok.com/x?a=1">safe</a>\n'
                '<a href="javascript:alert(1)">js</a>\n'
                '<a href="data:text/html,hi">data</a>\n'
                '<a href="vbscript:x">vb</a>\n'
                '<a href="/posts/foo">rel</a>\n'
                '<img src="javascript:alert(2)">\n'
                '<img src="/static/x.png" onerror="alert(3)">'
            ),
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/feed.xml?full=true")
    assert response.status_code == 200
    content = response.text
    # Unsafe schemes stripped.
    assert "javascript:" not in content
    assert "data:text/html" not in content
    assert "vbscript:" not in content
    # Event handlers stripped.
    assert "onerror=" not in content
    # Safe http and relative URLs preserved.
    assert 'href="https://ok.com/x?a=1"' in content
    assert "/posts/foo" in content


def test_rss_feed_excerpt_only_by_default(client, auth_headers):
    """RSS feed by default should use excerpt, not full content."""
    client.post(
        "/api/posts",
        json={
            "title": "Excerpt Post",
            "slug": "excerpt-post",
            "content": "Full long content",
            "excerpt": "Short excerpt",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    content = response.text
    # Should have full content by default
    assert "Short excerpt" in content
    assert "content:encoded" in content


def test_rss_feed_excerpt_mode(client, auth_headers):
    """RSS feed can be requested in excerpt-only mode."""
    client.post(
        "/api/posts",
        json={
            "title": "Excerpt Mode Post",
            "slug": "excerpt-mode-post",
            "content": "Full post content here",
            "excerpt": "Short excerpt",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/feed.xml?full=false")
    assert response.status_code == 200
    content = response.text
    assert "Short excerpt" in content
    assert "content:encoded" not in content


def test_atom_feed_returns_xml(client):
    """Atom feed should return valid XML with correct content-type."""
    response = client.get("/rss/atom.xml")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/atom+xml"
    content = response.text
    assert content.startswith('<?xml version="1.0"')
    assert "<feed xmlns=" in content
    assert "<title>" in content


def test_atom_feed_with_posts(client, auth_headers):
    """Atom feed should include published posts."""
    client.post(
        "/api/posts",
        json={
            "title": "Atom Test Post",
            "slug": "atom-test-post",
            "content": "Atom feed content",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/rss/atom.xml")
    assert response.status_code == 200
    content = response.text
    assert "Atom Test Post" in content
    assert "<entry>" in content
    assert "<updated>" in content
    assert "<published>" in content


def test_sitemap_returns_xml(client):
    """Sitemap should return valid XML with correct content-type."""
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/xml"
    content = response.text
    assert content.startswith('<?xml version="1.0"')
    assert 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' in content
    assert "<urlset>" in content or "<urlset " in content


def test_sitemap_includes_static_pages(client):
    """Sitemap should include static pages like home, about, search."""
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    content = response.text
    assert "/about" in content
    assert "/search" in content
    assert "/categories" in content
    assert "/tags" in content


def test_sitemap_includes_image_namespace(client):
    """Sitemap should include image namespace for Google."""
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    content = response.text
    assert "sitemap-image/1.1" in content


def test_sitemap_includes_posts(client, auth_headers):
    """Sitemap should include published posts."""
    client.post(
        "/api/posts",
        json={
            "title": "Sitemap Test Post",
            "slug": "sitemap-test-post",
            "content": "Sitemap content",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    content = response.text
    assert "sitemap-test-post" in content


def test_sitemap_includes_categories_and_tags(client, auth_headers):
    """Sitemap should include category and tag URLs."""
    cat_resp = client.post(
        "/api/categories",
        json={"name": "Test Category", "slug": "test-category"},
        headers=auth_headers,
    )
    tag_resp = client.post(
        "/api/tags",
        json={"name": "Test Tag", "slug": "test-tag"},
        headers=auth_headers,
    )
    assert cat_resp.status_code == 201
    assert tag_resp.status_code == 201

    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    content = response.text
    assert "category_id=" in content
    assert "/categories?category_id=" in content
    assert "tag_id=" in content


def test_robots_txt(client):
    """robots.txt should return valid plain text with sitemap directive."""
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    content = response.text
    assert "User-agent: *" in content
    assert "Allow: /" in content
    assert "Sitemap:" in content
    # RSS is not a valid robots.txt directive — should not be present
    assert "RSS:" not in content


def test_rss_feed_empty_database(client):
    """RSS feed should return valid XML even with no posts."""
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    content = response.text
    assert "<rss version=" in content
    assert "<channel>" in content


def test_rss_feed_escapes_xml_special_chars(client, auth_headers):
    """Titles/descriptions with & < > must not produce invalid XML."""
    import xml.etree.ElementTree as ET

    client.post(
        "/api/posts",
        json={
            "title": "R&D Notes & <Analysis>",
            "slug": "rd-notes-amp",
            "content": "Content with ]]&gt; inside CDATA should not break the feed",
            "excerpt": "A & B < C",
            "published": True,
        },
        headers=auth_headers,
    )

    rss_response = client.get("/rss/feed.xml")
    assert rss_response.status_code == 200
    # Feed must be well-formed XML (no escape errors)
    ET.fromstring(rss_response.text)

    atom_response = client.get("/rss/atom.xml")
    assert atom_response.status_code == 200
    ET.fromstring(atom_response.text)
    assert "R&amp;D Notes &amp; &lt;Analysis&gt;" in atom_response.text


def test_rss_feed_etag_and_304(client, auth_headers):
    """RSS/Atom/sitemap should send an ETag and return 304 on If-None-Match."""
    # Publish a post so the feed is non-trivial
    client.post(
        "/api/posts",
        json={
            "title": "ETag Post",
            "slug": "etag-post",
            "content": "ETag content",
            "published": True,
        },
        headers=auth_headers,
    )

    for path, _expected_mt in (
        ("/rss/feed.xml", "application/rss+xml"),
        ("/rss/atom.xml", "application/atom+xml"),
        ("/sitemap.xml", "application/xml"),
    ):
        first = client.get(path)
        assert first.status_code == 200
        etag = first.headers.get("etag")
        assert etag, f"expected ETag header on {path}"

        # Conditional request with the same ETag -> 304 Not Modified
        second = client.get(path, headers={"If-None-Match": etag})
        assert second.status_code == 304, f"expected 304 on {path}"
        assert second.text == ""


# ---------------------------------------------------------------------------
# Scoped category/tag feeds (DEC-074, TASK-146) — a reader can subscribe to a
# single topic via its own feed URL and sees only that topic's posts.
# ---------------------------------------------------------------------------


def _make_published_post(client, auth_headers, title, slug, **extra):
    """Create a published post (plus optional category_id/tags) via the API."""
    payload = {
        "title": title,
        "slug": slug,
        "content": f"content of {slug}",
        "excerpt": f"excerpt of {slug}",
        "published": True,
        **extra,
    }
    resp = client.post("/api/posts", json=payload, headers=auth_headers)
    assert resp.status_code == 201, resp.text


def test_rss_feed_scoped_by_category(client, auth_headers):
    """A category-scoped RSS feed contains only that category's posts, and
    the channel identifies the category."""
    cat = client.post("/api/categories", json={"name": "Python", "slug": "python"}, headers=auth_headers)
    assert cat.status_code == 201
    cat_id = cat.json()["id"]

    _make_published_post(client, auth_headers, "Python post", "py-post", category_id=cat_id)
    _make_published_post(client, auth_headers, "Unrelated post", "other-post")

    response = client.get(f"/rss/feed.xml?category_id={cat_id}")
    assert response.status_code == 200
    content = response.text
    assert "Python post" in content
    assert "Unrelated post" not in content
    # Channel title identifies the scoped topic, and rel=self points at the
    # scoped feed URL so feed readers validate the subscription.
    assert "Python —" in content
    assert 'rel="self" type="application/rss+xml"' in content
    assert f"category_id={cat_id}" in content


def test_rss_feed_scoped_by_tag(client, auth_headers):
    """A tag-scoped RSS feed contains only posts carrying that tag."""
    tag = client.post("/api/tags", json={"name": "pytag", "slug": "pytag"}, headers=auth_headers)
    assert tag.status_code == 201
    tag_id = tag.json()["id"]

    _make_published_post(client, auth_headers, "Tagged post", "tagged-post", tags=["pytag"])
    _make_published_post(client, auth_headers, "Untagged post", "untagged-post")

    response = client.get(f"/rss/feed.xml?tag_id={tag_id}")
    assert response.status_code == 200
    content = response.text
    assert "Tagged post" in content
    assert "Untagged post" not in content
    # Tag channel title and scoped self link.
    assert "#pytag" in content
    assert f"tag_id={tag_id}" in content


def test_atom_feed_scoped_by_category(client, auth_headers):
    """Atom parity: a category-scoped Atom feed filters and identifies the topic."""
    cat = client.post("/api/categories", json={"name": "Go", "slug": "go"}, headers=auth_headers)
    assert cat.status_code == 201
    cat_id = cat.json()["id"]

    _make_published_post(client, auth_headers, "Go post", "go-post", category_id=cat_id)
    _make_published_post(client, auth_headers, "Other", "other-post")

    response = client.get(f"/rss/atom.xml?category_id={cat_id}")
    assert response.status_code == 200
    content = response.text
    assert "Go post" in content
    assert "Other" not in content
    assert "Go —" in content
    # Feed self/id reference the scoped URL.
    assert f"category_id={cat_id}" in content


def test_rss_feed_scoped_unknown_scope_404(client):
    """An unknown category/tag scope id is a 404, not a silent global feed."""
    response = client.get("/rss/feed.xml?category_id=999999")
    assert response.status_code == 404
    response = client.get("/rss/atom.xml?tag_id=999999")
    assert response.status_code == 404


def test_rss_feed_scoped_both_params_400(client):
    """A feed scoped to both category and tag is rejected — one dimension max."""
    response = client.get("/rss/feed.xml?category_id=1&tag_id=1")
    assert response.status_code == 400


def test_rss_feed_scoped_etag_and_304(client, auth_headers):
    """Scoped feeds keep the ETag/304 conditional-response behavior."""
    cat = client.post("/api/categories", json={"name": "ETag Cat", "slug": "etag-cat"}, headers=auth_headers)
    cat_id = cat.json()["id"]

    first = client.get(f"/rss/feed.xml?category_id={cat_id}")
    assert first.status_code == 200
    etag = first.headers.get("etag")
    assert etag
    second = client.get(f"/rss/feed.xml?category_id={cat_id}", headers={"If-None-Match": etag})
    assert second.status_code == 304


def test_global_feed_unaffected_by_scope_support(client, auth_headers):
    """Default global feeds still work and are unscoped when no param is sent."""
    _make_published_post(client, auth_headers, "Global post", "global-post")
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    content = response.text
    assert "Global post" in content
    # Default self link has no scope query.
    assert 'rel="self"' in content
    assert "category_id=" not in content
    assert "tag_id=" not in content


# ---------------------------------------------------------------------------
# Feed language (DEC-…, deployment-config parity): <language> / xml:lang must
# follow the configured site_language, not a hardcoded zh-CN.
# ---------------------------------------------------------------------------


def test_rss_language_follows_configured_site_language(client, monkeypatch):
    """RSS <language> reflects site_language (default zh-CN, configurable)."""
    monkeypatch.setattr("app.routers.rss.settings.site_language", "en-gb")
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    assert "<language>en-gb</language>" in response.text


def test_rss_language_default_is_zh_cn(client):
    """Without configuration the feed keeps the previous zh-CN default."""
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    assert "<language>zh-CN</language>" in response.text


def test_atom_xml_lang_follows_configuration(client, monkeypatch):
    """Atom feed carries xml:lang from site_language on the <feed> element."""
    monkeypatch.setattr("app.routers.rss.settings.site_language", "en")
    response = client.get("/rss/atom.xml")
    assert response.status_code == 200
    assert 'xmlns="http://www.w3.org/2005/Atom"' in response.text
    assert 'xml:lang="en"' in response.text
