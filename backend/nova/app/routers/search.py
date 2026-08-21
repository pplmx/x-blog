import html
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..crud import _has_cjk, search_posts
from ..database import get_db
from ..limiter import RATE_LIMIT_SEARCH, limiter
from ..models import Post
from ..schemas import PostList

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
    if is_postgres and not _has_cjk(query):
        ts_query = func.plainto_tsquery("english", query)
        headline = func.ts_headline(
            "english",
            post.content,
            ts_query,
            "StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=20, ShortWord=3",
        )
        result = db.execute(headline).scalar()
        if not result:
            return post.excerpt or post.content[:200]
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


def _naive_utc(value: datetime | None) -> datetime | None:
    """Coerce a client-supplied (possibly tz-aware) filter to naive UTC.

    The created_at columns are naive UTC; comparing a tz-aware bind against a
    naive timestamp column errors on PostgreSQL, so normalize at the boundary —
    a date-only value parses as midnight naive and is left as-is.
    """
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


@router.get("")
@limiter.limit(f"{RATE_LIMIT_SEARCH}/minute")
def search(
    request: Request,  # noqa: ARG001
    q: str = Query(..., min_length=1, max_length=MAX_QUERY_LENGTH),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    category: str | None = Query(None, max_length=50, description="narrow to a category by name"),
    tag: str | None = Query(None, max_length=50, description="narrow to a tag by name"),
    date_from: datetime | None = Query(None, description="created_at >= (ISO date or datetime)"),
    date_to: datetime | None = Query(None, description="created_at <= (ISO date or datetime)"),
    sort: str = Query("relevance", description="relevance | newest | oldest | views"),
    db: Session = Depends(get_db),
):
    if sort not in VALID_SORTS:
        raise HTTPException(status_code=422, detail=f"sort must be one of {list(VALID_SORTS)}")
    is_postgres = db.get_bind().dialect.name == "postgresql"
    posts, total = search_posts(
        db,
        query=q,
        page=page,
        limit=limit,
        category=category or None,
        tag=tag or None,
        date_from=_naive_utc(date_from),
        date_to=_naive_utc(date_to),
        sort=sort,
    )

    # ts_headline is only useful for ASCII queries — CJK/mixed go through the
    # Python highlighter so Postgres CJK snippets highlight too (DEC-071).
    use_headline = is_postgres and not _has_cjk(q)
    snippets = _build_postgres_snippets(db, posts, q) if use_headline else {}

    items = []
    for p in posts:
        if use_headline:
            snippet = snippets.get(p.id)
            if snippet is None and q.strip():
                snippet = p.excerpt or p.content[:200]
        else:
            snippet = _build_snippet(p, q, is_postgres, db)
        post_dict = PostList.model_validate(p).model_dump()
        post_dict["snippet"] = snippet
        items.append(post_dict)

    return {
        "items": items,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "total_pages": (total + limit - 1) // limit,
        },
    }
