import html
import re

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..crud import search_posts
from ..database import get_db
from ..limiter import RATE_LIMIT_SEARCH, limiter
from ..models import Post
from ..schemas import PostList

router = APIRouter(prefix="/api/search", tags=["search"])

# Cap query length so malicious input cannot drive expensive regex/DB work.
MAX_QUERY_LENGTH = 200


def _highlight_sqlite(content: str, query: str) -> str:
    """Simple regex-based highlighting for SQLite.

    Content is HTML-escaped *before* highlighting so the ``<mark>`` tags we
    inject are the only markup present in the result — article text can never
    smuggle raw HTML into the snippet.
    """
    words = [re.escape(w) for w in query.split() if w]
    if not words:
        return html.escape(content[:300])
    pattern = f"({'|'.join(words)})"
    escaped = html.escape(content)
    highlighted = re.sub(pattern, r"<mark>\1</mark>", escaped, flags=re.IGNORECASE)
    return highlighted[:500] if len(highlighted) > 500 else highlighted


def _build_snippet(post: Post, query: str, is_postgres: bool, db: Session) -> str | None:
    """Generate a search snippet with highlighted matches."""
    if not query.strip():
        return None
    if is_postgres:
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
    return _highlight_sqlite(post.excerpt or post.content[:300], query)


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


@router.get("")
@limiter.limit(f"{RATE_LIMIT_SEARCH}/minute")
def search(
    request: Request,  # noqa: ARG001
    q: str = Query(..., min_length=1, max_length=MAX_QUERY_LENGTH),
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    is_postgres = db.get_bind().dialect.name == "postgresql"
    posts, total = search_posts(db, query=q, page=page, limit=limit)

    # Postgres: compute ts_headline for the whole page in a single query to
    # avoid an N+1 round-trip per result (ISS-061).
    snippets = _build_postgres_snippets(db, posts, q) if is_postgres else {}

    items = []
    for p in posts:
        if is_postgres:
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
