from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.parse import urlparse
from xml.sax.saxutils import escape

import markdown as md
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import crud, models
from app.cache import feed_cache
from app.conditional import PUBLIC_CACHE_CONTROL, conditional_response
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
    skip re-downloading a body that hasn't changed (RIL TASK-089). Delegates to
    the shared conditional helper (TASK-128) so feeds also carry Cache-Control
    and the 304 revalidates the stored copy's freshness window.
    """
    return conditional_response(body, media_type, request, PUBLIC_CACHE_CONTROL)


def _resolve_feed_scope(
    db: Session, category_id: int | None, tag_id: int | None
) -> tuple[models.Category | None, models.Tag | None]:
    """Resolve the optional category/tag scope of a feed request.

    A subscription is scoped to at most one dimension — a category or a tag —
    so the channel title stays unambiguous; passing both is rejected. An
    unknown scope id is a 404 rather than a silent fallback to the global
    feed: scoped feed links are emitted by the category/tag browse pages, so a
    bad id is a real error, not a reader preference (DEC-074, TASK-146).
    """
    if category_id is not None and tag_id is not None:
        raise HTTPException(status_code=400, detail="Provide at most one of category_id and tag_id")
    if category_id is not None:
        category = crud.get_category(db, category_id)
        if category is None:
            raise HTTPException(status_code=404, detail="Category not found")
        return category, None
    if tag_id is not None:
        tag = crud.get_tag(db, tag_id)
        if tag is None:
            raise HTTPException(status_code=404, detail="Tag not found")
        return None, tag
    return None, None


def _scoped_feed_meta(
    site_title: str,
    site_description: str,
    category: models.Category | None,
    tag: models.Tag | None,
) -> tuple[str, str]:
    """Feed title/description that identify the optional topic scope."""
    if category is not None:
        return f"{category.name} — {site_title}", f"{site_description} · category: {category.name}"
    if tag is not None:
        return f"#{tag.name} — {site_title}", f"{site_description} · tag: {tag.name}"
    return site_title, site_description


def _feed_self_url(site_url: str, kind: str, category_id: int | None, tag_id: int | None) -> str:
    """The rel=self URL of a (possibly scoped) feed, mirroring its query params."""
    path = {"rss": "/rss/feed.xml", "atom": "/rss/atom.xml"}[kind]
    params = []
    if category_id is not None:
        params.append(f"category_id={category_id}")
    if tag_id is not None:
        params.append(f"tag_id={tag_id}")
    suffix = f"?{'&'.join(params)}" if params else ""
    return f"{site_url}{path}{suffix}"


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


def generate_rss_feed(
    posts: list,
    site_url: str,
    title: str,
    description: str,
    full_content: bool = False,
    self_url: str | None = None,
) -> str:
    """Generate RSS 2.0 feed.

    Args:
        posts: List of posts to include
        site_url: Base URL of the site
        title: Feed title
        description: Feed description
        full_content: If True, include full post content. If False, use excerpt.
        self_url: The feed's own URL for atom:link rel=self; defaults to the
            global feed URL. Scoped feeds pass their scoped URL so feed readers
            validate the subscription (DEC-074, TASK-146).
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

    rss_self = self_url or f"{site_url}/rss/feed.xml"
    rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
    <title>{escape(title)}</title>
    <link>{escape(site_url)}</link>
    <description>{escape(description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>{datetime.now(UTC).strftime("%a, %d %b %Y %H:%M:%S GMT")}</lastBuildDate>
    <atom:link href="{escape(rss_self)}" rel="self" type="application/rss+xml"/>
    {"".join(items)}
</channel>
</rss>"""
    return rss


@rss_router.get("/feed.xml")
def get_rss_feed(
    full: bool = True,
    category_id: int | None = None,
    tag_id: int | None = None,
    request: Request = None,  # type: ignore[assignment] — FastAPI injects it; never None at runtime
    db: Session = Depends(get_db),
) -> Response:
    """Get RSS 2.0 feed of published posts.

    Args:
        full: If True, include full post content instead of excerpt (default: True).
        category_id: If given, restrict the feed to posts in this category
            (DEC-074, TASK-146). Unknown id -> 404.
        tag_id: If given, restrict the feed to posts with this tag
            (DEC-074, TASK-146). Unknown id -> 404.

    Rendered feed is cached (feed_cache, TTL 300s) with the scope in the key,
    and invalidated on post writes via clear_posts_list_cache, so repeated
    poller hits don't re-query the DB or re-render markdown per request
    (RIL TASK-085, ISS-054).
    """
    category, tag = _resolve_feed_scope(db, category_id, tag_id)
    key = ("feed", full, category_id, tag_id)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/rss+xml", request)

    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True, category_id=category_id, tag_id=tag_id)

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    title, description = _scoped_feed_meta(site_title, site_description, category, tag)
    self_url = _feed_self_url(site_url, "rss", category_id, tag_id)

    rss_content = generate_rss_feed(posts, site_url, title, description, full_content=full, self_url=self_url)
    feed_cache[key] = rss_content

    return _feed_response(rss_content, "application/rss+xml", request)


@rss_router.get("/atom.xml")
def get_atom_feed(
    category_id: int | None = None,
    tag_id: int | None = None,
    request: Request = None,  # type: ignore[assignment] — FastAPI injects it; never None at runtime
    db: Session = Depends(get_db),
) -> Response:
    """Get Atom feed of published posts, optionally scoped to a category/tag
    (DEC-074, TASK-146; same semantics as the RSS feed)."""
    category, tag = _resolve_feed_scope(db, category_id, tag_id)
    key = ("atom", category_id, tag_id)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/atom+xml", request)

    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True, category_id=category_id, tag_id=tag_id)

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    title, description = _scoped_feed_meta(site_title, site_description, category, tag)
    self_url = _feed_self_url(site_url, "atom", category_id, tag_id)

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
    <link href="{escape(self_url)}" rel="self"/>
    <id>{escape(self_url)}</id>
    <subtitle>{escape(description)}</subtitle>
    <updated>{datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}</updated>
    {"".join(items)}
</feed>"""

    feed_cache[key] = atom
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
