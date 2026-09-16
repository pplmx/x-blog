from datetime import UTC, datetime
from html.parser import HTMLParser
from urllib.parse import quote, urlparse
from xml.sax.saxutils import escape

import markdown as md
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import auth, crud, models
from app.cache import feed_cache
from app.conditional import PUBLIC_CACHE_CONTROL, conditional_response
from app.config import settings
from app.database import get_db
from app.schemas import IdInt

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
    language: str = "zh-CN",
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
        language: RSS <language> tag (defaults to the deployment's site_language).
    """
    items = []
    for post in posts:
        # Feed dates must report when readers actually got the post: a
        # scheduled post's item keyed to its draft created_at would push the
        # entry down readers' "new" ordering and mis-date it (RIL ISS-264).
        pub_date = crud.effective_publish_ts(post).strftime("%a, %d %b %Y %H:%M:%S GMT")
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
    <language>{escape(language)}</language>
    <lastBuildDate>{datetime.now(UTC).strftime("%a, %d %b %Y %H:%M:%S GMT")}</lastBuildDate>
    <atom:link href="{escape(rss_self)}" rel="self" type="application/rss+xml"/>
    {"".join(items)}
</channel>
</rss>"""
    return rss


def _comment_permalink(site_url: str, comment: models.Comment) -> str:
    """Deep link for a comment feed item — ON the comment (#comment-{id}),
    matching the /discussion page and DEC-321, not just the post headline."""
    slug = comment.post.slug if comment.post else ""
    return f"{site_url}/posts/{slug}#comment-{comment.id}"


def _comment_display_name(comment: models.Comment) -> str:
    """The commenter label for a feed item: the verified display name when the
    comment is reader-attributed, else the stored nickname (same fallback as
    the discussion page)."""
    if comment.reader is not None and comment.reader.display_name:
        return comment.reader.display_name
    return comment.nickname or "commenter"


def generate_comments_rss_feed(
    comments: list,
    site_url: str,
    title: str,
    description: str,
    self_url: str,
    language: str = "zh-CN",
) -> str:
    """Generate an RSS 2.0 feed of the latest approved comments (round 368,
    DEC-409). One item per comment: the post title as the entry title, the
    comment content as the description, and a perma link ON the comment."""
    items = []
    for c in comments:
        pub_date = c.created_at.strftime("%a, %d %b %Y %H:%M:%S GMT") if c.created_at else ""
        link = _comment_permalink(site_url, c)
        post_title = c.post.title if c.post else "Comment"
        who = _comment_display_name(c)
        items.append(f"""<item>
        <title>{_cdata(f"{who} · {post_title}")}</title>
        <link>{escape(link)}</link>
        <guid isPermaLink="true">{escape(link)}</guid>
        <pubDate>{pub_date}</pubDate>
        <description>{_cdata(c.content or "")}</description>
    </item>""")
    rss = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
    <title>{escape(title)}</title>
    <link>{escape(site_url)}</link>
    <description>{escape(description)}</description>
    <language>{escape(language)}</language>
    <lastBuildDate>{datetime.now(UTC).strftime("%a, %d %b %Y %H:%M:%S GMT")}</lastBuildDate>
    <atom:link href="{escape(self_url)}" rel="self" type="application/rss+xml"/>
    {"".join(items)}
</channel>
</rss>"""
    return rss


def generate_comments_atom_feed(
    comments: list,
    site_url: str,
    title: str,
    description: str,
    self_url: str,
    language: str = "zh-CN",
) -> str:
    """Atom feed variant of the discussion feed (round 368, DEC-409)."""
    items = []
    for c in comments:
        updated = (c.created_at or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ")
        link = _comment_permalink(site_url, c)
        post_title = c.post.title if c.post else "Comment"
        who = _comment_display_name(c)
        items.append(f"""<entry>
        <title>{escape(f"{who} · {post_title}")}</title>
        <link href="{escape(link)}"/>
        <id>{escape(link)}</id>
        <updated>{updated}</updated>
        <published>{updated}</published>
        <summary>{_cdata(c.content or "")}</summary>
        <content type="html">{_cdata(c.content or "")}</content>
    </entry>""")
    atom = f"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="{escape(language)}">
    <title>{escape(title)}</title>
    <link href="{escape(site_url)}"/>
    <link href="{escape(self_url)}" rel="self"/>
    <id>{escape(self_url)}</id>
    <subtitle>{escape(description)}</subtitle>
    <updated>{datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}</updated>
    {"".join(items)}
</feed>"""
    return atom


@rss_router.get("/comments.xml")
def get_comments_rss_feed(
    request: Request = None,  # type: ignore[assignment] — FastAPI injects it; never None at runtime
    db: Session = Depends(get_db),
) -> Response:
    """RSS 2.0 feed of the latest approved comments site-wide (round 368, DEC-409).

    The conversation is findable (comment search, DEC-405), browsable
    (/discussion, DEC-407) — this makes it SUBSCRIBABLE: a reader who wants the
    discussion as a stream in their feed reader gets the newest approved
    comments with the same public-visibility gate (pending/rejected and
    draft/scheduled-post comments never appear; content never carries email/ip).
    Cached under a scoped key like the post feeds.
    """
    key = ("rss-comments",)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/rss+xml", request)

    comments, _ = crud.list_public_comment_feed(db, page=1, limit=20)
    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    self_url = f"{site_url}/rss/comments.xml"
    rss = generate_comments_rss_feed(
        comments,
        site_url,
        f"{site_title} · Discussion",
        f"{site_description} · latest approved comments",
        self_url,
        language=settings.site_language,
    )
    feed_cache[key] = rss
    return _feed_response(rss, "application/rss+xml", request)


@rss_router.get("/comments.atom.xml")
def get_comments_atom_feed(
    request: Request = None,  # type: ignore[assignment] — FastAPI injects it; never None at runtime
    db: Session = Depends(get_db),
) -> Response:
    """Atom feed variant of the discussion feed (round 368, DEC-409)."""
    key = ("atom-comments",)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/atom+xml", request)

    comments, _ = crud.list_public_comment_feed(db, page=1, limit=20)
    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    self_url = f"{site_url}/rss/comments.atom.xml"
    atom = generate_comments_atom_feed(
        comments,
        site_url,
        f"{site_title} · Discussion",
        f"{site_description} · latest approved comments",
        self_url,
        language=settings.site_language,
    )
    feed_cache[key] = atom
    return _feed_response(atom, "application/atom+xml", request)


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
    # Fire the scheduled-post publish-time fan-out (DEC-336/TASK-394): an RSS
    # poller is the most reliable read surface for a crossing scheduled post
    # (external cron hits the feed continuously), and the crossing has no
    # write-time trigger to announce it. Cheap indexed no-op when nothing
    # crossed; exactly-once per post by the durable stamp.
    crud.maybe_notify_due_scheduled_posts(db)
    key = ("feed", full, category_id, tag_id)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/rss+xml", request)

    posts, _ = crud.get_posts(
        db, skip=0, limit=20, published=True, category_id=category_id, tag_id=tag_id, pinned_first=False
    )

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    title, description = _scoped_feed_meta(site_title, site_description, category, tag)
    self_url = _feed_self_url(site_url, "rss", category_id, tag_id)

    rss_content = generate_rss_feed(
        posts,
        site_url,
        title,
        description,
        full_content=full,
        self_url=self_url,
        language=settings.site_language,
    )
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
    # Same scheduled-post publish-time fan-out as the RSS feed (DEC-336/
    # TASK-394): the crossing has no write-time trigger, so the Atom read path
    # is one of the surfaces that notice it. Exactly-once by durable stamp.
    crud.maybe_notify_due_scheduled_posts(db)
    key = ("atom", category_id, tag_id)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/atom+xml", request)

    posts, _ = crud.get_posts(
        db, skip=0, limit=20, published=True, category_id=category_id, tag_id=tag_id, pinned_first=False
    )

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    title, description = _scoped_feed_meta(site_title, site_description, category, tag)
    self_url = _feed_self_url(site_url, "atom", category_id, tag_id)

    items = []
    for post in posts:
        updated = (post.updated_at or crud.utc_now_naive()).strftime("%Y-%m-%dT%H:%M:%SZ")
        # Same policy as the RSS pubDate: a scheduled post's <published> is its
        # publish_at, never the draft's created_at (RIL ISS-264).
        published = crud.effective_publish_ts(post).strftime("%Y-%m-%dT%H:%M:%SZ")
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
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="{escape(settings.site_language)}">
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


@rss_router.get("/category/{name}.xml")
def get_category_rss_feed(
    name: str,
    full: bool = True,
    request: Request = None,  # type: ignore[assignment] — FastAPI injects it
    db: Session = Depends(get_db),
) -> Response:
    """RSS 2.0 feed scoped to a category (by its unique name; DEC-130/TASK-177).

    Category has no slug column — its unique ``name`` is the stable, URL-encoded
    path segment. Unknown name -> 404. Cached under a scoped key.
    """
    category = crud.get_category_by_name(db, name)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    # Scheduled-post publish-time fan-out (DEC-344/TASK-398): a scoped feed is
    # a polled surface that surfaces crossed posts — fire the exactly-once
    # sweep like the sitewide feeds. Cheap indexed no-op when nothing crossed.
    crud.maybe_notify_due_scheduled_posts(db)
    key = ("rss-category", name, full)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/rss+xml", request)

    posts, _ = crud.get_posts(db, skip=0, limit=20, published=True, category_id=category.id, pinned_first=False)

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    title = f"{category.name} — {site_title}"
    description = f"{site_description} · category: {category.name}"
    self_url = f"{site_url}/rss/category/{quote(name)}.xml"

    rss = generate_rss_feed(
        posts,
        site_url,
        title,
        description,
        full_content=full,
        self_url=self_url,
        language=settings.site_language,
    )
    feed_cache[key] = rss
    return _feed_response(rss, "application/rss+xml", request)


@rss_router.get("/series/{slug}.xml")
def get_series_rss_feed(
    slug: str,
    full: bool = True,
    request: Request = None,  # type: ignore[assignment] — FastAPI injects it
    db: Session = Depends(get_db),
) -> Response:
    """RSS 2.0 feed scoped to a series (by its slug; DEC-130/TASK-177).

    Unknown slug -> 404. Cached under a scoped key.
    """
    series = crud.get_series_by_slug(db, slug)
    if not series:
        raise HTTPException(status_code=404, detail="Series not found")
    # Scheduled-post publish-time fan-out (DEC-344/TASK-398): same sweep as the
    # other polled feed surfaces; a series feed poller is a reliable crossing
    # trigger. Exactly-once by the durable stamp.
    crud.maybe_notify_due_scheduled_posts(db)
    key = ("rss-series", slug, full)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/rss+xml", request)

    posts = crud.get_series_visible_posts(db, series)[:20]

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    title = f"{series.title} — {site_title}"
    description = f"{site_description} · series: {series.title}"
    self_url = f"{site_url}/rss/series/{quote(slug)}.xml"

    rss = generate_rss_feed(
        posts,
        site_url,
        title,
        description,
        full_content=full,
        self_url=self_url,
        language=settings.site_language,
    )
    feed_cache[key] = rss
    return _feed_response(rss, "application/rss+xml", request)


@rss_router.get("/authors/{author_id}.xml")
def get_author_rss_feed(
    author_id: IdInt,
    full: bool = True,
    request: Request = None,  # type: ignore[assignment] — FastAPI injects it
    db: Session = Depends(get_db),
) -> Response:
    """RSS 2.0 feed scoped to one public writer (DEC-359, round 345).

    Subscribing to /rss/authors/{id}.xml delivers exactly that writer's
    published posts. Same no-oracle boundary as the archive page: a pen-named
    admin is the author's public identity; an unknown id and a username-only
    admin answer the SAME 404, so the feed cannot enumerate admins or reveal
    which usernames exist. Cached under a scoped key.
    """
    author = db.query(auth.User).filter(auth.User.id == author_id).first()
    if author is None or not author.display_name:
        raise HTTPException(status_code=404, detail="Author not found")
    # Scheduled-post publish-time fan-out (DEC-344/TASK-398): a scoped feed is
    # a polled surface — fire the exactly-once sweep like the other feeds.
    crud.maybe_notify_due_scheduled_posts(db)
    key = ("rss-author", author_id, full)
    cached = feed_cache.get(key)
    if cached is not None:
        return _feed_response(cached, "application/rss+xml", request)

    posts, _ = crud.get_posts(
        db,
        skip=0,
        limit=20,
        published=True,
        author_id=author_id,
        pinned_first=False,
    )

    site_url = getattr(settings, "site_url", "http://localhost:3000")
    site_title = getattr(settings, "site_title", "X-Blog")
    site_description = getattr(settings, "site_description", "A modern blog built with FastAPI and Next.js")
    title = f"{author.display_name} — {site_title}"
    description = f"{site_description} · author: {author.display_name}"
    self_url = f"{site_url}/rss/authors/{author_id}.xml"

    rss = generate_rss_feed(
        posts,
        site_url,
        title,
        description,
        full_content=full,
        self_url=self_url,
        language=settings.site_language,
    )
    feed_cache[key] = rss
    return _feed_response(rss, "application/rss+xml", request)


# Sitemap endpoints (at root)

# Page size for the sitemap's post walk (DEC-318, TASK-387). One page per
# fetch bounds per-request memory while the loop covers the FULL post set —
# a single hard limit silently dropped every post past it from the sitemap
# (and thus from search engines).
SITEMAP_POST_PAGE = 1000


@seo_router.get("/sitemap.xml")
def get_sitemap(request: Request = None, db: Session = Depends(get_db)) -> Response:  # type: ignore[assignment]
    """Get XML sitemap of the site."""
    # Scheduled-post publish-time fan-out (DEC-344/TASK-398): the sitemap's
    # crawl hit surfaces a crossed post — fire the exactly-once sweep too.
    crud.maybe_notify_due_scheduled_posts(db)
    cached = feed_cache.get("sitemap")
    if cached is not None:
        return _feed_response(cached, "application/xml", request)

    # Page through ALL published posts until a short page — no silent cap.
    posts: list = []
    offset = 0
    while True:
        page, _ = crud.get_posts(db, skip=offset, limit=SITEMAP_POST_PAGE, published=True, pinned_first=False)
        posts.extend(page)
        offset += len(page)
        if len(page) < SITEMAP_POST_PAGE:
            break
    categories = crud.get_categories(db)
    tags = crud.get_tags(db)
    series_list = crud.list_series(db)

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

    # Series (indexable /series/{slug} pages — the old sitemap omitted them
    # entirely, so serialized content was unreachable-by-sitemap, DEC-318).
    for series in series_list:
        updated = (series.updated_at or crud.utc_now_naive()).strftime("%Y-%m-%d")
        urls.append(f"""<url>
    <loc>{escape(site_url)}/series/{escape(series.slug)}</loc>
    <lastmod>{updated}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
</url>""")

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

    # Authors (round 348): the /authors index and every pen-named writer's
    # archive are indexable /authors/{id} pages — before this they were
    # reachable-by-link but unknown to crawlers. The index is unconditional
    # (it renders an empty state, still a real page); each writer's lastmod is
    # their most recent published post's update, so the archive freshness
    # tracks the content it lists.
    urls.append(f"""<url>
    <loc>{site_url}/authors</loc>
    <changefreq>weekly</changefreq>
    <priority>0.4</priority>
</url>""")
    writers = (
        db.query(auth.User).filter(auth.User.display_name.isnot(None)).order_by(auth.User.display_name.asc()).all()
    )
    if writers:
        author_lastmod_rows = (
            db.query(models.Post.author_id, func.max(models.Post.updated_at))
            .filter(
                models.Post.author_id.isnot(None),
                models.Post.published.is_(True),
                models.Post.author_id.in_([w.id for w in writers]),
            )
            .group_by(models.Post.author_id)
            .all()
        )
        author_lastmod = {int(author_id): lastmod for author_id, lastmod in author_lastmod_rows}
        for writer in writers:
            # The admin User has no updated_at column; a writer with no published
            # post yet falls back to "now" (their archive is still a real page).
            updated = author_lastmod.get(writer.id) or crud.utc_now_naive()
            urls.append(f"""<url>
    <loc>{escape(site_url)}/authors/{writer.id}</loc>
    <lastmod>{updated.strftime("%Y-%m-%d")}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.5</priority>
</url>""")

    # Static pages (round 347): a published /pages/{slug} is a real indexable
    # page (privacy policy / terms / contact), so it belongs in the sitemap;
    # drafts are unpublished and must stay out.
    published_pages = db.query(models.Page).filter(models.Page.published.is_(True)).all()
    for page in published_pages:
        updated = page.updated_at or crud.utc_now_naive()
        urls.append(f"""<url>
    <loc>{escape(site_url)}/pages/{escape(page.slug)}</loc>
    <lastmod>{updated.strftime("%Y-%m-%d")}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.4</priority>
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
