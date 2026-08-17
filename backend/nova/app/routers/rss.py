from datetime import UTC, datetime
from hashlib import sha1
from html.parser import HTMLParser
from urllib.parse import urlparse
from xml.sax.saxutils import escape

import markdown as md
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import crud
from app.cache import feed_cache
from app.config import settings
from app.database import get_db

# RSS router with /rss prefix
rss_router = APIRouter(prefix="", tags=["rss"])

# SEO router at root
seo_router = APIRouter(tags=["seo"])


def _cdata(value: str) -> str:
    """Wrap a value in a CDATA section, safely splitting any embedded ']]>'."""
    return f"<![CDATA[{value.replace(']]>', ']]]]><![CDATA[>')}]]>"


def _feed_response(body: str, media_type: str, request: Request) -> Response:
    """Build a Response with an ETag, honoring If-None-Match (304).

    Bloated feeds (RSS/Atom/sitemap) are re-polled by readers, crawlers and
    checkers; a strong ETag lets them cheaply fetch a 304 Not Modified and
    skip re-downloading a body that hasn't changed (RIL TASK-089).
    """
    etag = f'"{sha1(body.encode("utf-8")).hexdigest()}"'
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and etag in {t.strip() for t in if_none_match.split(",")}:
        return Response(status_code=304, headers={"ETag": etag})
    return Response(content=body, media_type=media_type, headers={"ETag": etag})


# Elements stripped from feed content (can never appear) — the allow-list of
# tags/attrs that survive mirrors the frontend's markdown+DOMPurify pipeline so
# feed readers get the rendered article, not raw markdown, and never script.
_ALLOWED_TAGS = {
    "p",
    "br",
    "hr",
    "a",
    "img",
    "em",
    "strong",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "del",
    "sup",
    "sub",
    "span",
    "div",
}
_ALLOWED_ATTRS = {"href", "src", "alt", "title", "target", "rel"}

# URL-bearing attributes that would let an author ship a scriptable link into
# an untrusted reader (web-based RSS/Atom consumers may render these). The Nuxt
# frontend strips javascript:/data:/vbscript: via DOMPurify; mirror that here so
# the feed path gets the same defence-in-depth (RIL TASK-091, ISS-071).
_URL_ATTRS = {"href", "src"}
_UNSAFE_SCHEMES = ("javascript", "data", "vbscript")


def _safe_attrs(attrs: list) -> list:
    """Keep only allowed attrs, dropping on* handlers and scriptable URLs."""
    allowed = []
    for k, v in attrs:
        if k not in _ALLOWED_ATTRS or k.lower().startswith("on"):
            continue
        if k in _URL_ATTRS:
            scheme = urlparse(v).scheme.lower()
            if scheme in _UNSAFE_SCHEMES:
                continue
        allowed.append((k, v))
    return allowed


class _FeedSanitizer(HTMLParser):
    """Strip disallowed tags and unsafe attributes from rendered markdown.

    `convert_charrefs=False` keeps entity references intact so character
    refs in the source content aren't double-escaped.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self._stack: list[str] = []

    # Void (empty) elements have no closing tag per HTML5. HTMLParser reports
    # `<br>`/`<hr>`/`<img>` as handle_starttag (not handle_startendtag), so
    # pushing them onto the stack consumes a slot that a later real close tag
    # pops — dropping the enclosing `</p>`/`</div>`. Markdown's nl2br emits
    # `<br>`, so this corrupted full-content RSS/Atom feeds (RIL TASK-108).
    _VOID_TAGS = frozenset({"br", "hr", "img"})

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in _ALLOWED_TAGS:
            if tag not in self._VOID_TAGS:
                self._stack.append(tag)
            allowed = _safe_attrs(attrs)
            attr_str = "".join(f' {k}="{escape(v, {"&": "&amp;", '"': "&quot;"})}"' for k, v in allowed)
            self.out.append(f"<{tag}{attr_str}>")
        else:
            self._stack.append("")  # placeholder so a matching close tag is dropped

    def handle_endtag(self, tag: str) -> None:
        if self._stack:
            opened = self._stack.pop()
            if opened == tag:
                self.out.append(f"</{tag}>")

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        if tag in _ALLOWED_TAGS:
            allowed = _safe_attrs(attrs)
            attr_str = "".join(f' {k}="{escape(v, {"&": "&amp;", '"': "&quot;"})}"' for k, v in allowed)
            self.out.append(f"<{tag}{attr_str}/>")

    def handle_data(self, data: str) -> None:
        self.out.append(data)

    def handle_entityref(self, name: str) -> None:
        self.out.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.out.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        pass

    def handle_pi(self, data: str) -> None:
        pass

    def handle_decl(self, decl: str) -> None:
        pass


def _feed_content_html(content: str) -> str:
    """Render a post's Markdown to sanitized HTML for full-content feeds."""
    html = md.markdown(content, extensions=["fenced_code", "tables", "nl2br"])
    sanitizer = _FeedSanitizer()
    sanitizer.feed(html)
    sanitizer.close()
    return "".join(sanitizer.out)


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
        pub_date = (post.created_at or crud.utc_now_naive()).strftime("%a, %d %b %Y %H:%M:%S GMT")
        link = f"{site_url}/posts/{post.slug}"

        if full_content:
            # Full content RSS — render markdown to sanitized HTML so feed
            # readers show the article, not literal markdown syntax (ISS-039).
            content = f"<content:encoded>{_cdata(_feed_content_html(post.content))}</content:encoded>"
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
def get_rss_feed(full: bool = True, request: Request = None, db: Session = Depends(get_db)) -> Response:  # type: ignore[assignment]
    """Get RSS 2.0 feed of published posts.

    Args:
        full: If True, include full post content instead of excerpt (default: True).

    Rendered feed is cached (feed_cache, TTL 300s) and invalidated on post
    writes via clear_posts_list_cache, so repeated poller hits don't re-query
    the DB or re-render markdown per request (RIL TASK-085, ISS-054).
    """
    key = ("feed", full)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/rss+xml", request)

    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True)

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    title = getattr(settings, "site_title", "X-Blog")
    description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")

    rss_content = generate_rss_feed(posts, site_url, title, description, full_content=full)
    feed_cache[key] = rss_content

    return _feed_response(rss_content, "application/rss+xml", request)


@rss_router.get("/atom.xml")
def get_atom_feed(request: Request = None, db: Session = Depends(get_db)) -> Response:  # type: ignore[assignment]
    """Get Atom feed of published posts."""
    cached = feed_cache.get("atom")
    if cached is not None:
        return _feed_response(cached, "application/atom+xml", request)

    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True)

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    title = getattr(settings, "site_title", "X-Blog")
    description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")

    items = []
    for post in posts:
        updated = (post.updated_at or crud.utc_now_naive()).strftime("%Y-%m-%dT%H:%M:%SZ")
        published = (post.created_at or crud.utc_now_naive()).strftime("%Y-%m-%dT%H:%M:%SZ")
        content = _feed_content_html(post.content)
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

    feed_cache["atom"] = atom
    return _feed_response(atom, "application/atom+xml", request)


# Sitemap endpoints (at root)
@seo_router.get("/sitemap.xml")
def get_sitemap(request: Request = None, db: Session = Depends(get_db)) -> Response:  # type: ignore[assignment]
    """Get XML sitemap of the site."""
    cached = feed_cache.get("sitemap")
    if cached is not None:
        return _feed_response(cached, "application/xml", request)

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

    # Categories browse page
    urls.append(f"""<url>
    <loc>{site_url}/categories</loc>
    <changefreq>weekly</changefreq>
    <priority>0.4</priority>
</url>""")

    # Tags browse page
    urls.append(f"""<url>
    <loc>{site_url}/tags</loc>
    <changefreq>weekly</changefreq>
    <priority>0.4</priority>
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
    <loc>{site_url}/categories?category_id={cat["id"]}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
</url>""")

    # Tags
    for tag in tags:
        urls.append(f"""<url>
    <loc>{site_url}/?tag_id={tag["id"]}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
</url>""")

    sitemap = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
    {"".join(urls)}
</urlset>"""

    feed_cache["sitemap"] = sitemap
    return _feed_response(sitemap, "application/xml", request)


@seo_router.get("/robots.txt")
def get_robots_txt():
    """Get robots.txt file."""
    site_url = getattr(settings, "site_url", "http://localhost:3000")

    robots = f"""User-agent: *
Allow: /

Sitemap: {site_url}/sitemap.xml
"""

    return Response(content=robots, media_type="text/plain")
