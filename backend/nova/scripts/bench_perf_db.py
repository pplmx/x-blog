"""Benchmark the real hot-path CRUD queries against the seeded perf DB.

Timing runs the production code paths (app.crud.get_posts / get_archive /
get_post_by_slug / search_posts / comment listing) — not hand-written SQL — so
the numbers reflect exactly what the API serves. EXPLAIN ANALYZE dumps the SQL
of the list/search/archive query families (compiled with literal_binds so the
planner sees real constants).

Run:
    DATABASE_URL=postgresql+psycopg2://postgres:postgres@10.112.9.49:13310/xblog_perf \
        APP_ENV=development JWT_SECRET_KEY=perf-bench-secret \
        .venv/bin/python scripts/bench_perf_db.py
"""

import sys
import time
from datetime import UTC, datetime

from sqlalchemy import create_engine, extract, func, or_, text
from sqlalchemy.orm import Session, joinedload

sys.path.insert(0, ".")

from app import models  # noqa: E402
from app.crud import _effective_publish_col, get_archive, get_post_by_slug, get_posts, search_posts  # noqa: E402

ENGINE_URL = "postgresql+psycopg2://postgres:postgres@10.112.9.49:13310/xblog_perf"
NOW_NAIVE = datetime.now(UTC).replace(tzinfo=None)


def bench(label: str, fn, n: int = 5) -> object:
    best = float("inf")
    for _ in range(n):
        t0 = time.perf_counter()
        result = fn()
        dt = (time.perf_counter() - t0) * 1000
        best = min(best, dt)
    print(f"  {label:<52} {best:8.2f} ms")
    return result


def explain(conn, statement, label: str) -> None:
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    print(f"  ──{label} ──")
    for (line,) in conn.execute(text("EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) " + sql)):
        print("    " + line)
    print()


def public_filter(q):
    return q.filter(
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= NOW_NAIVE),
    )


def list_stmt(q, skip=0, limit=10):
    efp = _effective_publish_col()
    return (
        q.options(joinedload(models.Post.category), joinedload(models.Post.tags), joinedload(models.Post.series))
        .order_by(func.coalesce(models.Post.pinned, False).desc(), efp.desc(), models.Post.id.desc())
        .offset(skip)
        .limit(limit)
        .statement
    )


def count_stmt(q):
    return q.with_entities(func.count()).order_by(None).statement


def main() -> None:
    engine = create_engine(ENGINE_URL, pool_size=3)
    db = Session(engine)
    conn = engine.connect()
    efp = _effective_publish_col()

    print("== home feed ==")
    posts, total = bench("home page 10", lambda: get_posts(db, limit=10))
    print(f"    result rows={len(posts)} total={total}")

    print("== EXPLAIN: home count + list ==")
    explain(
        conn,
        count_stmt(
            db.query(models.Post).filter(
                models.Post.published.is_(True),
                or_(models.Post.publish_at.is_(None), models.Post.publish_at <= NOW_NAIVE),
            )
        ),
        "count",
    )
    explain(conn, list_stmt(public_filter(db.query(models.Post))), "list")

    print("== category / tag / author feeds ==")
    bench("category 3 page 10", lambda: get_posts(db, category_id=3, limit=10))
    bench("tag 5 page 10", lambda: get_posts(db, tag_id=5, limit=10))
    bench("author 1 page 10", lambda: get_posts(db, author_id=1, limit=10))
    bench("deep page skip=3000", lambda: get_posts(db, skip=3000, limit=10))
    print("== EXPLAIN: deep page list (offset 3000) ==")
    explain(conn, list_stmt(public_filter(db.query(models.Post)), skip=3000), "deep list")

    print("== year/month archive feed ==")
    bench("year 2025 month 11", lambda: get_posts(db, year=2025, month=11, limit=10))
    explain(
        conn,
        list_stmt(
            public_filter(db.query(models.Post)).filter(
                extract("year", efp) == 2025,
                extract("month", efp) == 11,
            )
        ),
        "year/month list",
    )

    print("== get_archive() ==")
    bench("archive group by y/m", lambda: get_archive(db))
    explain(
        conn,
        db.query(
            extract("year", efp).label("year"),
            extract("month", efp).label("month"),
            func.count(models.Post.id).label("count"),
        )
        .filter(
            models.Post.published.is_(True), or_(models.Post.publish_at.is_(None), models.Post.publish_at <= NOW_NAIVE)
        )
        .group_by("year", "month")
        .order_by(extract("year", efp).desc(), extract("month", efp).desc())
        .statement,
        "archive",
    )

    print("== post detail / search ==")
    bench("detail by slug", lambda: get_post_by_slug(db, "perf-post-2500"))
    bench("search ascii 'python'", lambda: search_posts(db, "python"))
    bench("search cjk '评论'", lambda: search_posts(db, "评论"))

    print("== comment listing (approved, asc) ==")
    bench("comments post 2500", lambda: _comments_for(db, 2500))
    explain(
        conn,
        db.query(models.Comment)
        .filter(models.Comment.post_id == 2500, models.Comment.is_approved.is_(True))
        .order_by(models.Comment.created_at.asc(), models.Comment.id.asc())
        .statement,
        "comments post 2500",
    )

    db.rollback()
    db.close()
    engine.dispose()


def _comments_for(db, pid):
    return (
        db.query(models.Comment)
        .filter(models.Comment.post_id == pid, models.Comment.is_approved.is_(True))
        .order_by(models.Comment.created_at.asc(), models.Comment.id.asc())
        .all()
    )


if __name__ == "__main__":
    main()
