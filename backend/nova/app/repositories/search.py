"""Public search across posts/series/pages/authors plus search logging."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import auth, models

from ._base import _effective_publish_col, escape_like_pattern, utc_now_naive


def _has_cjk(query: str) -> bool:
    """True when the query contains CJK ideographs.

    Postgres ``to_tsvector('english')`` tokenizes CJK as opaque runs, so
    full-text search cannot match partial/prefix Chinese terms ('评' vs content
    '评论系统') — while SQLite's ILIKE substring path handles them fine. Detect
    CJK in Python (not by dialect) so the fallback to substring matching is
    identical on SQLite and Postgres. (DEC-070, TASK-143)
    """
    return any(
        ("㐀" <= ch <= "䶿")  # CJK Extension A
        or ("一" <= ch <= "鿿")  # CJK Unified Ideographs
        or ("豈" <= ch <= "﫿")  # CJK Compatibility Ideographs
        for ch in query
    )


def _has_searchable_token(query: str) -> bool:
    """True when the query contains at least one alphanumeric character.

    ``plainto_tsquery('english', ...)`` tokenizes punctuation-only input (a
    bare ``%``, ``_``, ``.``, ...) to an EMPTY tsquery, which matches nothing —
    while the ILIKE substring path escapes and matches those literals (issue
    #20). Treating such queries as tsvector on Postgres silently returns zero
    hits for a query that finds literal matches on SQLite, so route them down
    the same dialect-agnostic substring path for consistent cross-backend
    results. (PG-harness finding, TASK-246)
    """
    return any(ch.isalnum() for ch in query)


async def search_posts(
    db: AsyncSession,
    query: str,
    page: int = 1,
    limit: int = 10,
    category: str | None = None,
    tag: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = "relevance",
) -> tuple[list[models.Post], int]:
    offset = (page - 1) * limit
    is_postgres = db.get_bind().dialect.name == "postgresql"
    # CJK/mixed queries (and punctuation-only queries that tsvector cannot
    # tokenize into a non-empty tsquery) go through the dialect-agnostic ILIKE
    # substring path on every backend; only pure-ASCII Postgres queries keep
    # tsvector relevance. See _has_searchable_token.
    use_tsvector = is_postgres and not _has_cjk(query) and _has_searchable_token(query)

    now = utc_now_naive()
    # Scheduled posts are not searchable before their publish_at (same rule as list)
    scheduled_filter = or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now)

    # Narrowing filters (DEC-084, TASK-154): category/tag by NAME, plus a
    # date range over the EFFECTIVE publish time — a scheduled post is
    # findable in the window it actually went live, matching the feed/archive
    # (RIL ISS-266). Applied identically on both dialect paths. The columns
    # are naive UTC (see utc_now_naive); coerce whatever the client sent
    # (naive or aware, ISO or date) to naive UTC before comparing.
    filters = []
    if category:
        filters.append(models.Post.category_id.in_(select(models.Category.id).where(models.Category.name == category)))
    if tag:
        filters.append(models.Post.tags.any(models.Tag.name == tag))
    if date_from is not None:
        filters.append(_effective_publish_col() >= date_from)
    if date_to is not None:
        filters.append(_effective_publish_col() <= date_to)

    # Sort applied below per dialect branch (tsvector relevance is a real
    # metric; the CJK substring path has none, so "relevance" degrades to
    # newest there — documented in DEC-084). newest/oldest also key off
    # effective publish time so search order matches the feed order.
    def _sort_order(ts_vector=None, ts_query=None):
        # Every branch ends with a Post.id tiebreak: equal keys (two posts
        # batch-scheduled to the same whole-second publish_at, equal view
        # counts) would otherwise resolve by query plan, making pages unstable
        # (a post appearing on page 1 and again on page 2) — the same
        # deterministic ordering get_posts already enforces (RIL ISS-284).
        if sort == "newest":
            return (_effective_publish_col().desc(), models.Post.id.desc())
        if sort == "oldest":
            return (_effective_publish_col().asc(), models.Post.id.asc())
        if sort == "views":
            # COALESCE NULL views (TASK-535) — same PG/SQLite parity as the
            # popular-posts ranking; a raw/legacy NULL row must rank as 0.
            return (func.coalesce(models.Post.views, 0).desc(), models.Post.id.desc())
        if sort == "relevance" and ts_vector is not None:
            return (func.ts_rank(ts_vector, ts_query).desc(), models.Post.id.desc())
        return (_effective_publish_col().desc(), models.Post.id.desc())

    if use_tsvector:
        ts_query = func.plainto_tsquery("english", query)
        ts_vector = func.to_tsvector(
            "english",
            models.Post.title + " " + func.coalesce(models.Post.excerpt, "") + " " + models.Post.content,
        )

        stmt = (
            select(models.Post)
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
            .where(ts_vector.op("@@")(ts_query))
            .order_by(*_sort_order(ts_vector, ts_query))
            .options(
                joinedload(models.Post.category),
                joinedload(models.Post.tags),
                joinedload(models.Post.series),
            )
            .offset(offset)
            .limit(limit)
        )

        count_stmt = (
            select(func.count(models.Post.id))
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
            .where(ts_vector.op("@@")(ts_query))
        )
    else:
        # CJK/mixed substring matching: every whitespace-separated term must
        # appear (as a substring) in the title, excerpt, or content. Per-term
        # OR over fields, AND over terms — mirrors plainto_tsquery AND semantics
        # so a query like "TypeScript 类型" matches TypeScript in the title and
        # 类型 in the content. excerpt is covered like the tsvector path.
        terms = [t for t in query.split() if t] or [query]
        fields = (
            models.Post.title,
            models.Post.excerpt,
            models.Post.content,
        )
        term_clauses = [
            and_(or_(*(field.ilike(f"%{escape_like_pattern(term)}%", escape="\\") for field in fields)))
            for term in terms
        ]

        stmt = (
            select(models.Post)
            .where(and_(*term_clauses))
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
            .order_by(*_sort_order())
            .options(
                joinedload(models.Post.category),
                joinedload(models.Post.tags),
                joinedload(models.Post.series),
            )
            .offset(offset)
            .limit(limit)
        )

        count_stmt = (
            select(func.count(models.Post.id))
            .where(and_(*term_clauses))
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
        )

    posts = list((await db.execute(stmt)).unique().scalars())
    total = (await db.execute(count_stmt)).scalar() or 0
    assert total is not None  # COUNT(*) always yields one row

    return posts, total


def _term_substring_clauses(terms: list[str], *fields) -> list:
    """Per-term substring-AND clauses over ``fields`` (the combined-search path).

    Mirrors search_posts's dialect-agnostic branch (DEC-084): every
    whitespace-separated term must appear as a substring in at least one of the
    given columns, with LIKE metacharacters escaped so a literal ``%``/``_`` is
    matched, never treated as a wildcard. ILIKE is inherently CJK-aware and
    dialect-parity (SQLite/Postgres), which is exactly why the new non-post
    search targets use it uniformly — no tsvector, keeping every backend's
    substring semantics identical.
    """
    return [and_(or_(*(field.ilike(f"%{escape_like_pattern(t)}%", escape="\\") for field in fields))) for t in terms]


async def search_series(
    db: AsyncSession,
    query: str,
    limit: int = 10,
    offset: int = 0,
) -> tuple[list[models.Series], int]:
    """Series window for the combined search (COMBINED-ALL search).

    Series have no published flag — the public list (list_series) exposes every
    one of them — so the whole table is indexed, matching its read API exactly.
    Matches title OR description with the shared substring-AND discipline
    (CJK-aware, dialect-parity). Newest first with an id tiebreak.
    """
    if not query.strip():
        return [], 0
    terms = [t for t in query.split() if t] or [query]
    base = select(models.Series).where(*_term_substring_clauses(terms, models.Series.title, models.Series.description))
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    items = list(
        (
            await db.execute(
                base.order_by(models.Series.created_at.desc(), models.Series.id.desc()).offset(offset).limit(limit)
            )
        ).scalars()
    )
    return items, total


async def search_pages(
    db: AsyncSession,
    query: str,
    limit: int = 10,
    offset: int = 0,
) -> tuple[list[models.Page], int]:
    """Static-page window for the combined search (COMBINED-ALL search).

    Published pages only — the same ``published`` gate the public /api/pages
    read route applies, so a draft page never leaks into search. Matches title
    OR content. Newest-touched first with an id tiebreak.
    """
    if not query.strip():
        return [], 0
    terms = [t for t in query.split() if t] or [query]
    base = (
        select(models.Page)
        .where(models.Page.published.is_(True))
        .where(*_term_substring_clauses(terms, models.Page.title, models.Page.content))
    )
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    items = list(
        (
            await db.execute(
                base.order_by(models.Page.updated_at.desc(), models.Page.id.desc()).offset(offset).limit(limit)
            )
        ).scalars()
    )
    return items, total


async def search_authors(
    db: AsyncSession,
    query: str,
    limit: int = 10,
    offset: int = 0,
) -> tuple[list[auth.User], int]:
    """Author-archive window for the combined search (COMBINED-ALL search).

    Pen-named admins only — ``display_name`` not null, the same gate the
    /api/authors surface uses, so a username-only admin (no public identity)
    never appears and the login username is never indexed. Matches the public
    pen name OR the public bio. Name order with an id tiebreak.
    """
    if not query.strip():
        return [], 0
    terms = [t for t in query.split() if t] or [query]
    base = (
        select(auth.User)
        .where(auth.User.display_name.isnot(None))
        .where(*_term_substring_clauses(terms, auth.User.display_name, auth.User.bio))
    )
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    items = list(
        (
            await db.execute(
                base.order_by(auth.User.display_name.asc(), auth.User.id.asc()).offset(offset).limit(limit)
            )
        ).scalars()
    )
    return items, total


async def log_search_query(db: AsyncSession, query: str | None) -> None:
    """Best-effort aggregate of a public search term (DEC-152/TASK-188).

    Normalizes to lowercased, trimmed (≤200 chars) and upserts a counter on the
    matching row. Never tied to a reader. A logging failure is swallowed — it
    must never break search.

    The counter increment is an atomic UPDATE expression (``count = count + 1``),
    never a read-modify-write: two concurrent searches for the same term each
    issuing SELECT-then-assign would both read N and both write N+1, silently
    dropping one increment (round 278 — the same lost-update class the
    daily-views counter was hardened against). The first-seen path inserts with
    count=1 and keeps the IntegrityError retry for the racing-first-insert case.
    """
    q = (query or "").strip().lower()[:200]
    if not q:
        return
    now = datetime.now(UTC).replace(tzinfo=None)
    bumped = cast(
        CursorResult[Any],
        await db.execute(
            update(models.SearchLog)
            .where(models.SearchLog.query == q)
            .values(count=models.SearchLog.count + 1, last_searched_at=now),
        ),
    )
    try:
        if bumped.rowcount == 0:
            db.add(models.SearchLog(query=q, count=1, last_searched_at=now))
        await db.commit()
    except IntegrityError:
        # Two first-time searches for the same term raced: the other request
        # inserted the row between our UPDATE-miss and INSERT. Roll back and
        # re-apply the atomic increment so the count is never stuck at 0.
        await db.rollback()
        await db.execute(
            update(models.SearchLog)
            .where(models.SearchLog.query == q)
            .values(count=models.SearchLog.count + 1, last_searched_at=now),
        )
        await db.commit()


async def get_top_searches(db: AsyncSession, limit: int = 10) -> list[dict]:
    """Top public search terms by aggregate count, newest-searched tiebreak."""
    rows = (
        await db.execute(
            select(models.SearchLog.query, models.SearchLog.count)
            .order_by(models.SearchLog.count.desc(), models.SearchLog.last_searched_at.desc())
            .limit(limit)
        )
    ).all()
    return [{"query": q, "count": c} for q, c in rows]
