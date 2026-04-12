from datetime import datetime
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import crud
from app.database import get_db
from app.config import settings

# RSS router with /rss prefix
rss_router = APIRouter(prefix="", tags=["rss"])

# SEO router at root
seo_router = APIRouter(tags=["seo"])


def generate_rss_feed(posts: list, site_url: str, title: str, description: str) -> str:
    """Generate RSS 2.0 feed."""
    items = []
    for post in posts:
        pub_date = post.created_at.strftime("%a, %d %b %Y %H:%M:%S GMT")
        items.append(f"""<item>
        <title><![CDATA[{post.title}]]></title>
        <link>{site_url}/posts/{post.slug}</link>
        <guid isPermaLink="true">{site_url}/posts/{post.slug}</guid>
        <pubDate>{pub_date}</pubDate>
        <description><![CDATA[{post.excerpt or post.content[:200]}]]></description>
    </item>""")

    rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
    <title>{title}</title>
    <link>{site_url}</link>
    <description>{description}</description>
    <language>zh-CN</language>
    <lastBuildDate>{datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")}</lastBuildDate>
    <atom:link href="{site_url}/rss/feed.xml" rel="self" type="application/rss+xml"/>
    {''.join(items)}
</channel>
</rss>"""
    return rss


@rss_router.get("/feed.xml")
def get_rss_feed(db: Session = Depends(get_db)):
    """Get RSS 2.0 feed of published posts."""
    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True)
    
    site_url = getattr(settings, 'site_url', 'http://localhost:3000')
    title = getattr(settings, 'site_title', 'X-Blog')
    description = getattr(settings, 'site_description', 'A modern blog built with FastAPI and Next.js')
    
    rss_content = generate_rss_feed(posts, site_url, title, description)
    
    return Response(content=rss_content, media_type="application/rss+xml")


@rss_router.get("/atom.xml")
def get_atom_feed(db: Session = Depends(get_db)):
    """Get Atom feed of published posts."""
    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True)
    
    site_url = getattr(settings, 'site_url', 'http://localhost:3000')
    title = getattr(settings, 'site_title', 'X-Blog')
    description = getattr(settings, 'site_description', 'A modern blog built with FastAPI and Next.js')
    
    items = []
    for post in posts:
        updated = post.updated_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        published = post.created_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        items.append(f"""<entry>
        <title>{post.title}</title>
        <link href="{site_url}/posts/{post.slug}"/>
        <id>{site_url}/posts/{post.slug}</id>
        <updated>{updated}</updated>
        <published>{published}</published>
        <summary>{post.excerpt or post.content[:200]}</summary>
    </entry>""")
    
    atom = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>{title}</title>
    <link href="{site_url}"/>
    <link href="{site_url}/rss/atom.xml" rel="self"/>
    <id>{site_url}/rss/atom.xml</id>
    <subtitle>{description}</subtitle>
    <updated>{datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")}</updated>
    {''.join(items)}
</feed>"""
    
    return Response(content=atom, media_type="application/atom+xml")


# Sitemap endpoints (at root)
@seo_router.get("/sitemap.xml")
def get_sitemap(db: Session = Depends(get_db)):
    """Get XML sitemap of the site."""
    posts, _ = crud.get_posts(db, skip=0, limit=1000, published=True)
    categories = crud.get_categories(db)
    tags = crud.get_tags(db)
    
    site_url = getattr(settings, 'site_url', 'http://localhost:3000')
    
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
        updated = post.updated_at.strftime("%Y-%m-%d")
        urls.append(f"""<url>
    <loc>{site_url}/posts/{post.slug}</loc>
    <lastmod>{updated}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
</url>""")
    
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
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    {''.join(urls)}
</urlset>"""
    
    return Response(content=sitemap, media_type="application/xml")


@seo_router.get("/robots.txt")
def get_robots_txt():
    """Get robots.txt file."""
    site_url = getattr(settings, 'site_url', 'http://localhost:3000')
    
    robots = f"""User-agent: *
Allow: /

Sitemap: {site_url}/sitemap.xml
RSS: {site_url}/rss/feed.xml
"""
    
    return Response(content=robots, media_type="text/plain")