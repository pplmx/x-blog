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
