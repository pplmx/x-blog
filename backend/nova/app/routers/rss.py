from datetime import UTC, datetime
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import crud
from app.config import settings
from app.database import get_db

# RSS router with /rss prefix
rss_router = APIRouter(prefix="", tags=["rss"])

# SEO router at root
seo_router = APIRouter(tags=["seo"])


def _cdata(value: str) -> str:
    """Wrap a value in a CDATA section, safely splitting any embedded ']]>'."""
    return f"<![CDATA[{value.replace(']]>', ']]]]><![CDATA[>')}]]>"


def generate_rss_feed(posts: list, site_url: str, title: str, description: str, full_content: bool = False) -> str:
    """Generate RSS 2.0 feed.

    Args:
        posts: List of posts to include
        site_url: Base URL of the site
        title: Feed title
        description: Feed description
        full_content: If True, include full post content. If False, use excerpt.
    """
    items = []
    for post in posts:
        pub_date = post.created_at.strftime("%a, %d %b %Y %H:%M:%S GMT")
        link = f"{site_url}/posts/{post.slug}"

        if full_content:
            # Full content RSS
            content = f"<content:encoded>{_cdata(post.content)}</content:encoded>"
            items.append(f"""<item>
        <title>{_cdata(post.title)}</title>
        <link>{escape(link)}</link>
        <guid isPermaLink="true">{escape(link)}</guid>
        <pubDate>{pub_date}</pubDate>
        <description>{_cdata(post.excerpt or "")}</description>
        {content}
    </item>""")
        else:
            # Excerpt RSS (default)
            items.append(f"""<item>
        <title>{_cdata(post.title)}</title>
        <link>{escape(link)}</link>
        <guid isPermaLink="true">{escape(link)}</guid>
        <pubDate>{pub_date}</pubDate>
        <description>{_cdata(post.excerpt or post.content[:200])}</description>
    </item>""")

    rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
    <title>{escape(title)}</title>
    <link>{escape(site_url)}</link>
    <description>{escape(description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>{datetime.now(UTC).strftime("%a, %d %b %Y %H:%M:%S GMT")}</lastBuildDate>
    <atom:link href="{escape(site_url)}/rss/feed.xml" rel="self" type="application/rss+xml"/>
    {"".join(items)}
</channel>
</rss>"""
    return rss


@rss_router.get("/feed.xml")
def get_rss_feed(full: bool = True, db: Session = Depends(get_db)):
    """Get RSS 2.0 feed of published posts.

    Args:
        full: If True, include full post content instead of excerpt (default: True).
    """
    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True)

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    title = getattr(settings, "site_title", "X-Blog")
    description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")

    rss_content = generate_rss_feed(posts, site_url, title, description, full_content=full)

    return Response(content=rss_content, media_type="application/rss+xml")


@rss_router.get("/atom.xml")
def get_atom_feed(db: Session = Depends(get_db)):
    """Get Atom feed of published posts."""
    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True)

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    title = getattr(settings, "site_title", "X-Blog")
    description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")

    items = []
    for post in posts:
        updated = (post.updated_at or crud.utc_now_naive()).strftime("%Y-%m-%dT%H:%M:%SZ")
        published = (post.created_at or crud.utc_now_naive()).strftime("%Y-%m-%dT%H:%M:%SZ")
        content = post.content[:5000] if len(post.content) > 5000 else post.content
        link = f"{site_url}/posts/{post.slug}"
        items.append(f"""<entry>
        <title>{escape(post.title)}</title>
        <link href="{escape(link)}"/>
        <id>{escape(link)}</id>
        <updated>{updated}</updated>
        <published>{published}</published>
        <summary>{escape(post.excerpt or post.content[:200])}</summary>
        <content type="html">{_cdata(content)}</content>
    </entry>""")

    atom = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>{escape(title)}</title>
    <link href="{escape(site_url)}"/>
    <link href="{escape(site_url)}/rss/atom.xml" rel="self"/>
    <id>{escape(site_url)}/rss/atom.xml</id>
    <subtitle>{escape(description)}</subtitle>
    <updated>{datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}</updated>
    {"".join(items)}
</feed>"""

    return Response(content=atom, media_type="application/atom+xml")


# Sitemap endpoints (at root)
@seo_router.get("/sitemap.xml")
def get_sitemap(db: Session = Depends(get_db)):
    """Get XML sitemap of the site."""
    posts, _ = crud.get_posts(db, skip=0, limit=1000, published=True)
    categories = crud.get_categories(db)
    tags = crud.get_tags(db)

    site_url = getattr(settings, "site_url", "http://localhost:3000")

    urls = []

    # Home page
    urls.append(f"""<url>
    <loc>{site_url}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
</url>""")

    # About page
    urls.append(f"""<url>
    <loc>{site_url}/about</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
</url>""")

    # Search page
    urls.append(f"""<url>
    <loc>{site_url}/search</loc>
    <changefreq>weekly</changefreq>
    <priority>0.3</priority>
</url>""")

    # Posts
    for post in posts:
        updated = (post.updated_at or crud.utc_now_naive()).strftime("%Y-%m-%d")
        entry = f"""<url>
    <loc>{escape(site_url)}/posts/{escape(post.slug)}</loc>
    <lastmod>{updated}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
"""
        if post.cover_image:
            img_url = post.cover_image if post.cover_image.startswith("http") else f"{site_url}{post.cover_image}"
            entry += f"""    <image:image>
        <image:loc>{escape(img_url)}</image:loc>
    </image:image>
"""
        entry += "</url>"
        urls.append(entry)

    # Categories
    for cat in categories:
        urls.append(f"""<url>
    <loc>{site_url}/?category_id={cat.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
</url>""")

    # Tags
    for tag in tags:
        urls.append(f"""<url>
    <loc>{site_url}/?tag_id={tag.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
</url>""")

    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
    {"".join(urls)}
</urlset>"""

    return Response(content=sitemap, media_type="application/xml")


@seo_router.get("/robots.txt")
def get_robots_txt():
    """Get robots.txt file."""
    site_url = getattr(settings, "site_url", "http://localhost:3000")

    robots = f"""User-agent: *
Allow: /

Sitemap: {site_url}/sitemap.xml
"""

    return Response(content=robots, media_type="text/plain")
