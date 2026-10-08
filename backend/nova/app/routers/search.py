import html
import re
from contextlib import suppress
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import crud, models
from ..crud import _has_cjk, _has_searchable_token, log_search_query, search_posts
from ..database import get_db
from ..dates import inclusive_end_of_day, parse_bound
from ..limiter import RATE_LIMIT_SEARCH, limiter
from ..models import Post
from ..schemas import CommentPostBrief, CommentPublic, NonNulStr, PageInt, PostList
from ..suggest import SUGGEST_LIMIT, suggest_terms

router = APIRouter(prefix="/api/search", tags=["search"])

# Cap query length so malicious input cannot drive expensive regex/DB work.
MAX_QUERY_LENGTH = 200

# Snippet output budget (chars) and the context window around the first match.
SNIPPET_MAX = 500
SNIPPET_CONTEXT = 120


def _highlight_sqlite(content: str, query: str) -> str:
    """Build an HTML snippet around the first matched term, highlighting matches.

    Dialect-agnostic (works for CJK and ASCII alike — the CJK/Postgres snippet
    path since DEC-071/TASK-144). Windows around the first occurrence of any
    query term in the FULL content, so hits deep in long posts surface context
    instead of an arbitrary content[:300] prefix. Content is HTML-escaped
    *before* highlighting so the ``<mark>`` tags we inject are the only markup
    present in the result — article text can never smuggle raw HTML into the
    snippet.
    """
    terms = [t for t in query.split() if t]
    if not terms:
        return html.escape(content[:SNIPPET_MAX])

    # Window around the earliest match so the term is visible even mid-body.
    lower = content.lower()
    positions = [lower.find(t.lower()) for t in terms]
    positions = [p for p in positions if p != -1]
    if positions:
        start = max(0, min(positions) - SNIPPET_CONTEXT)
        content = content[start:]

    pattern = f"({'|'.join(re.escape(w) for w in terms)})"
    escaped = html.escape(content)
    highlighted = re.sub(pattern, r"<mark>\1</mark>", escaped, flags=re.IGNORECASE)
    if len(highlighted) <= SNIPPET_MAX:
        return highlighted
    # Truncate to a balanced snippet: never emit an unclosed <mark>. Scan from
    # the longest valid prefix that leaves equal <mark> and </mark> counts so we
    # keep as much highlighted context as possible.
    best = 0
    for cut in range(min(SNIPPET_MAX, len(highlighted)), 0, -1):
        prefix = highlighted[:cut]
        if prefix.count("<mark>") == prefix.count("</mark>"):
            best = cut
            break
    return highlighted[:best]


def _contains_any_term(text: str, query: str) -> bool:
    lower = text.lower()
    return any(t.lower() in lower for t in query.split() if t)


def _build_snippet(post: Post, query: str, is_postgres: bool, db: Session) -> str | None:
    """Generate a search snippet with highlighted matches.

    Routing mirrors search_posts (DEC-070): CJK/mixed queries use the
    dialect-agnostic highlighter on every backend (ts_headline('english')
    cannot reliably highlight CJK on Postgres); only pure-ASCII Postgres
    queries keep ts_headline."""
    if not query.strip():
        return None
    if is_postgres and not _has_cjk(query) and _has_searchable_token(query):
        ts_query = func.plainto_tsquery("english", query)
        headline = func.ts_headline(
            "english",
            post.content,
            ts_query,
            "StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=20, ShortWord=3",
        )
        result = db.execute(headline).scalar()
        if not result:
            # Raw excerpt/content fallback: same escaping guarantee as the
            # ts_headline branch (the module's snippet-XSS contract holds for
            # every path, not only the highlighted one).
            return html.escape(post.excerpt or post.content[:200])
        # ts_headline output is NOT guaranteed HTML-safe (see PostgreSQL docs
        # "Cross-site Scripting (XSS) Safety"): escape it, then restore only
        # the <mark> highlight delimiters we configured above.
        escaped = html.escape(result)
        return escaped.replace("&lt;mark&gt;", "<mark>").replace("&lt;/mark&gt;", "</mark>")
    # Prefer the excerpt only when it actually matches; otherwise window the
    # full content so a match deep in a long post still surfaces.
    if post.excerpt and _contains_any_term(post.excerpt, query):
        return _highlight_sqlite(post.excerpt, query)
    return _highlight_sqlite(post.content or "", query)


def _build_postgres_snippets(db: Session, posts: list[Post], query: str) -> dict[int, str | None]:
    """Compute ts_headline for a page of posts in ONE query (avoids N+1, ISS-061).

    Each per-post ts_headline call was a round-trip; a 50-post page meant up to
    51 queries. Batch with a single GROUP BY result of headline per post id.
    """
    if not posts or not query.strip():
        return {}
    ts_query = func.plainto_tsquery("english", query)
    q = func.ts_headline(
        "english",
        models.Post.content,
        ts_query,
        "StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=20, ShortWord=3",
    )
    post_ids = [p.id for p in posts]
    rows = db.query(models.Post.id, q).filter(models.Post.id.in_(post_ids)).group_by(models.Post.id, q).all()
    out: dict[int, str | None] = dict.fromkeys(post_ids)
    for pid, headline in rows:
        if not headline:
            continue
        # Escape, then restore only our <mark> delimiters (XSS-safe).
        escaped = html.escape(headline)
        out[pid] = escaped.replace("&lt;mark&gt;", "<mark>").replace("&lt;/mark&gt;", "</mark>")
    return out


# Sort orders accepted by /api/search (DEC-084, TASK-154). "relevance" is the
# only one that needs the tsvector rank (and degrades to newest on the CJK
# substring path); the rest are plain column orders.
VALID_SORTS = ("relevance", "newest", "oldest", "views")


@router.get("")
@limiter.limit(f"{RATE_LIMIT_SEARCH}/minute")
def search(
    request: Request,  # noqa: ARG001
    q: Annotated[NonNulStr, Query(min_length=1, max_length=MAX_QUERY_LENGTH)],
    page: PageInt = 1,
    limit: int = Query(10, ge=1, le=50),
    category: Annotated[NonNulStr | None, Query(max_length=50, description="narrow to a category by name")] = None,
    tag: Annotated[NonNulStr | None, Query(max_length=50, description="narrow to a tag by name")] = None,
    date_from: str | None = Query(
        None, max_length=40, description="effective publish time >= (ISO date or datetime) — publish_at ?? created_at"
    ),
    date_to: str | None = Query(
        None,
        max_length=40,
        description="effective publish time <= (ISO date or datetime; a bare date includes the whole day)",
    ),
    sort: str = Query("relevance", description="relevance | newest | oldest | views"),
    db: Session = Depends(get_db),
):
    if not q.strip():
        # A whitespace-only q passes min_length=1 but tokenizes to an empty
        # term, so crud.search_posts' `[t for t in query.split() if t] or [query]`
        # falls back to the raw " " → a content ILIKE '% %' matching nearly every
        # published post: an anonymous full-table scan on an unauthenticated
        # endpoint (round-296 deep-dive). Reject it at the boundary instead.
        raise HTTPException(status_code=422, detail="q must be a non-blank search term")
    if sort not in VALID_SORTS:
        raise HTTPException(status_code=422, detail=f"sort must be one of {list(VALID_SORTS)}")
    # Fire the scheduled-post publish-time fan-out (DEC-344/TASK-398): search
    # surfaces a crossed scheduled post like any public surface, so it must
    # trigger the same exactly-once announce. Cheap indexed no-op when nothing
    # crossed; the durable stamp prevents duplicates.
    crud.maybe_notify_due_scheduled_posts(db)
    is_postgres = db.get_bind().dialect.name == "postgresql"
    # date-only "to" bounds are inclusive of the picked day (see
    # dates.inclusive_end_of_day); parse both raw strings back to naive-UTC
    # datetimes, widening a bare-date date_to to end-of-day first.
    date_to = date_to and inclusive_end_of_day(date_to)
    posts, total = search_posts(
        db,
        query=q,
        page=page,
        limit=limit,
        category=category or None,
        tag=tag or None,
        date_from=parse_bound(date_from),
        date_to=parse_bound(date_to),
        sort=sort,
    )

    # ts_headline is only useful for ASCII queries — CJK/mixed (and
    # punctuation-only queries that tokenize to an empty tsquery) go through
    # the Python highlighter so Postgres snippets highlight too (DEC-071;
    # scope must mirror crud.search_posts's use_tsvector, TASK-246).
    use_headline = is_postgres and not _has_cjk(q) and _has_searchable_token(q)
    snippets = _build_postgres_snippets(db, posts, q) if use_headline else {}

    items = []
    for p in posts:
        if use_headline:
            snippet = snippets.get(p.id)
            if snippet is None and q.strip():
                # No ts_headline match for this individual post (or query) —
                # mirror the _build_snippet fallback's escaping so a raw
                # excerpt/content cannot break the snippet XSS-safety guarantee.
                snippet = html.escape(p.excerpt or p.content[:200])
        else:
            snippet = _build_snippet(p, q, is_postgres, db)
        post_dict = PostList.model_validate(p).model_dump()
        post_dict["snippet"] = snippet
        items.append(post_dict)

    # Search-term analytics (DEC-152/TASK-188): best-effort aggregate count.
    with suppress(Exception):
        log_search_query(db, q)

    return {
        "items": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        },
    }


def _sort_epoch(dt) -> float:
    """Comparable epoch for the combined search's cross-type sort.

    The per-type columns are all naive-UTC datetimes by ORM convention
    (utc_now_naive); ``timestamp()`` interprets a naive datetime as local
    time, but every value here is naive UTC, so the uniform offset preserves
    relative ordering across SQLite/Postgres and across runs. NULL → 0.0 so an
    item with no timestamp sorts last in a newest-first list.
    """
    return dt.timestamp() if dt is not None else 0.0


# Canonical cross-type item builders for the combined search (/api/search/all).
# Each returns the uniform envelope the frontend renders: a ``type`` tag, the
# deep-linkable ``path``, and a mark-safe highlighted snippet (escaped before
# <mark> — the same snippet-XSS guarantee the post/comment search holds).


def _all_post_item(post, query: str, is_postgres: bool, db: Session) -> dict:
    return {
        "type": "post",
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "path": f"/posts/{post.slug}",
        "snippet": _build_snippet(post, query, is_postgres, db),
    }


def _all_series_item(series, query: str) -> dict:
    return {
        "type": "series",
        "id": series.id,
        "title": series.title,
        "slug": series.slug,
        "path": f"/series/{series.slug}",
        "snippet": _highlight_sqlite(series.description or series.title, query) if series.description else None,
    }


def _all_page_item(page, query: str) -> dict:
    return {
        "type": "page",
        "id": page.id,
        "title": page.title,
        "slug": page.slug,
        "path": f"/pages/{page.slug}",
        "snippet": _highlight_sqlite(page.content or page.title, query),
    }


def _all_author_item(author, query: str) -> dict:
    return {
        "type": "author",
        "id": author.id,
        "title": author.display_name,
        "slug": None,
        "path": f"/authors/{author.id}",
        "snippet": _highlight_sqlite(author.bio, query) if author.bio else None,
    }


# Type rank order for a deterministic cross-type tiebreak in the merged sort.
_TYPE_RANK = {"post": 0, "series": 1, "page": 2, "author": 3}


@router.get("/all")
@limiter.limit(f"{RATE_LIMIT_SEARCH}/minute")
def search_all(
    request: Request,  # noqa: ARG001
    q: Annotated[NonNulStr, Query(min_length=1, max_length=MAX_QUERY_LENGTH)],
    page: PageInt = 1,
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Combined search across posts, series, published static pages and authors.

    Broadens /search beyond posts (and comments) so a term that lives only in a
    series title, a static page body, or an author pen name still lands the
    reader somewhere (the search box was otherwise a dead end for those
    surfaces). Each hit carries a ``type`` tag and a deep-linkable ``path``;
    results are merged newest-first with a deterministic cross-type tiebreak.

    Public-visibility gates match each surface's read API exactly: posts go
    through the same published + scheduled-passthrough predicate as /api/search
    (no draft/scheduled leak), pages are ``published`` only, series are all
    public (they have no draft state), and authors are pen-named admins only
    (a username-only admin has no public identity and is never indexed).

    Pagination: each source contributes its top ``offset+limit`` newest matches
    (a window that always covers the merged page — one source can supply at
    most ``offset+limit`` of the top ``offset+limit`` merged items), then the
    windows are merged, globally sorted and sliced. Same CJK-aware, dialect
    -parity substring matching as the post search (DEC-084).
    """
    if not q.strip():
        # Same non-blank guard as /api/search (round-296): a whitespace-only q
        # would otherwise ILIKE '% %' nearly every public row.
        raise HTTPException(status_code=422, detail="q must be a non-blank search term")
    # Scheduled-post fan-out: a crossed scheduled post is a public surface and
    # must announce exactly once (same rule as the other public surfaces).
    crud.maybe_notify_due_scheduled_posts(db)
    is_postgres = db.get_bind().dialect.name == "postgresql"

    offset = (page - 1) * limit
    window = offset + limit

    series, series_total = crud.search_series(db, q, limit=window)
    pages, pages_total = crud.search_pages(db, q, limit=window)
    authors, authors_total = crud.search_authors(db, q, limit=window)
    posts, posts_total = crud.search_posts(db, q, page=1, limit=window, sort="newest")

    ranked: list[tuple[float, dict]] = []
    for s in series:
        ranked.append((_sort_epoch(s.created_at), _all_series_item(s, q)))
    for pg in pages:
        ranked.append((_sort_epoch(pg.updated_at), _all_page_item(pg, q)))
    for a in authors:
        ranked.append((_sort_epoch(a.created_at), _all_author_item(a, q)))
    for p in posts:
        ranked.append((_sort_epoch(p.publish_at or p.created_at), _all_post_item(p, q, is_postgres, db)))

    ranked.sort(key=lambda pair: (pair[0], _TYPE_RANK[pair[1]["type"]], pair[1]["id"]), reverse=True)
    items = [item for _, item in ranked[offset : offset + limit]]
    total = series_total + pages_total + authors_total + posts_total

    return {
        "items": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if limit else 0,
        },
    }


@router.get("/comments")
@limiter.limit(f"{RATE_LIMIT_SEARCH}/minute")
def search_comments(
    request: Request,  # noqa: ARG001
    q: Annotated[NonNulStr, Query(min_length=1, max_length=MAX_QUERY_LENGTH)],
    page: PageInt = 1,
    limit: int = Query(20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """Find a discussion: approved comments on public posts whose content
    matches every term (round 366, DEC-405).

    The search box currently spans posts only; a reader who remembers a terse
    take in the thread (or wants every approved comment that mentions a topic)
    had no way to find it. Same public-visibility gate as the post search and
    list_reader_public_comments — is_approved AND the commented post is
    published with its publish_at passed — so a draft/scheduled post never
    leaks its discussion, and pending/rejected comments stay out. Threads on
    comment-DISABLED posts remain public, so they keep matching. Every hit
    carries a mark-safe highlighted snippet plus the post brief, so the result
    can land the reader ON the comment (#comment-{id}, DEC-321). Newest first
    with an id tiebreak.
    """
    if not q.strip():
        # Whitespace-only q tokenizes to " " and would ILIKE '% %' nearly every
        # public comment — reject at the boundary (same guard as /search,
        # round-296 deep-dive).
        raise HTTPException(status_code=422, detail="q must be a non-blank search term")
    comments, total = crud.search_comments(db, query=q, page=page, limit=limit)

    items = []
    for c in comments:
        base = CommentPublic.model_validate(c).model_dump()
        post = c.post  # joinedload in crud.search_comments
        items.append(
            {
                **base,
                # Highlighted <mark>-safe snippet from the shared highlighter
                # (escapes before marking, so comment text can never smuggle
                # raw HTML — the same guarantee /search's snippets hold).
                "snippet": _highlight_sqlite(c.content or "", q),
                "post": (CommentPostBrief(id=post.id, title=post.title, slug=post.slug) if post else None),
            }
        )

    return {
        "items": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit if limit else 0,
        },
    }


@router.get("/suggest")
@limiter.limit(f"{RATE_LIMIT_SEARCH}/minute")
def search_suggest(
    request: Request,  # noqa: ARG001
    q: Annotated[NonNulStr, Query(min_length=1, max_length=MAX_QUERY_LENGTH)],
    limit: int = Query(SUGGEST_LIMIT, ge=1, le=6),
    db: Session = Depends(get_db),
):
    """Search-term suggestions for a zero-hit query ("did you mean", round 390).

    The post search is exact substring + tsvector with no fuzzy layer, so a
    misspelled or half-remembered term ("recatvie", "响应试") dead-ends on an
    empty page. This endpoint scores a bounded vocabulary of canonical topics
    (tag/category names + recent public post titles) with plain Python edit
    distance — dialect-parity-free: a CJK one-character typo scores exactly
    like an ASCII one, and no Postgres extension is involved. The frontend
    calls it only after the post search returned zero hits, keeping it off the
    hot search path. Same non-blank guard, length cap, and rate-limit bucket
    as /api/search.
    """
    if not q.strip():
        raise HTTPException(status_code=422, detail="q must be a non-blank search term")
    return {"query": q, "suggestions": suggest_terms(db, query=q, limit=limit)}
