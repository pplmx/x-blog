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


def test_rss_feed_with_posts(client):
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
    )
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    content = response.text
    assert "RSS Test Post" in content
    assert "rss-test-post" in content


def test_rss_feed_full_content_flag(client):
    """RSS feed with full=true should include content:encoded."""
    client.post(
        "/api/posts",
        json={
            "title": "Full Content Post",
            "slug": "full-content-post",
            "content": "Full post content here",
            "published": True,
        },
    )
    response = client.get("/rss/feed.xml?full=true")
    assert response.status_code == 200
    content = response.text
    assert "content:encoded" in content
    assert "Full post content here" in content


def test_rss_feed_excerpt_only_by_default(client):
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
    )
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    content = response.text
    # Should have excerpt, not full content
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


def test_atom_feed_with_posts(client):
    """Atom feed should include published posts."""
    client.post(
        "/api/posts",
        json={
            "title": "Atom Test Post",
            "slug": "atom-test-post",
            "content": "Atom feed content",
            "published": True,
        },
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


def test_sitemap_includes_posts(client):
    """Sitemap should include published posts."""
    client.post(
        "/api/posts",
        json={
            "title": "Sitemap Test Post",
            "slug": "sitemap-test-post",
            "content": "Sitemap content",
            "published": True,
        },
    )
    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    content = response.text
    assert "sitemap-test-post" in content


def test_sitemap_includes_categories_and_tags(client):
    """Sitemap should include category and tag URLs."""
    cat_resp = client.post(
        "/api/categories",
        json={"name": "Test Category", "slug": "test-category"},
    )
    tag_resp = client.post(
        "/api/tags",
        json={"name": "Test Tag", "slug": "test-tag"},
    )
    assert cat_resp.status_code == 201
    assert tag_resp.status_code == 201

    response = client.get("/sitemap.xml")
    assert response.status_code == 200
    content = response.text
    assert "category_id=" in content
    assert "tag_id=" in content


def test_robots_txt(client):
    """robots.txt should return plain text with sitemap and rss links."""
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    content = response.text
    assert "User-agent: *" in content
    assert "Allow: /" in content
    assert "Sitemap:" in content
    assert "RSS:" in content


def test_rss_feed_empty_database(client):
    """RSS feed should return valid XML even with no posts."""
    response = client.get("/rss/feed.xml")
    assert response.status_code == 200
    content = response.text
    assert "<rss version=" in content
    assert "<channel>" in content
