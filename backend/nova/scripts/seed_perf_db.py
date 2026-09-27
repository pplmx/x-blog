"""Seed the perf-benchmark database (dev PG `xblog_perf`) with representative
data sized to make the query planner behave like production: thousands of
posts spanning ~3 years, comment trees, reader activity, taxonomies, series.

Pure scratch DB (created/dropped per benchmark run) — never pointed at
production. Run:
    DATABASE_URL=postgresql+psycopg2://postgres:postgres@10.112.9.49:13310/xblog_perf \
        .venv/bin/python scripts/seed_perf_db.py
"""

import os
import random
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

sys.path.insert(0, ".")

from app.auth import ReaderAccount, User  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    Category,
    Comment,
    CommentLike,
    Page,
    Post,
    PostRevision,
    PostViewsDaily,
    ReaderPostLike,
    ReadingHistory,
    SearchLog,
    Series,
    Tag,
    post_tags,
)

N_POSTS = 5000
N_COMMENTS = 15000
N_READERS = 400
N_USERS = 6
N_SERIES = 20

random.seed(20260927)

CJK_WORDS = ["评论", "系统", "设计", "类型检查", "性能", "缓存", "数据库", "索引", "并发", "用户"]
BODIES = [
    "赞！写得真好",
    "学到了，谢谢分享",
    "关于索引我还想请教一下",
    "mark 一下，很实用",
    "这条回复是楼中楼",
    "同问，蹲一个答案",
    "补充一点我的理解",
    "哈哈哈真实",
    "请问有相关文档吗",
    "这个坑我也踩过",
    "原来如此，涨知识了",
    "建议补充 benchmark 数据",
]
# ~3KB body, enough to exercise toast/tsvector cost like real prose.
BODY = (
    "这是一篇用于性能基准测试的正文段落（中文填充内容），覆盖评论系统、楼中楼回复、Web Push "
    "通知、搜索相关性排序、阅读历史等模块。" * 60
).strip()


# Shared dev-PostgreSQL root (host/user/pass/db all 'postgres'), used to create
# the scratch database when it is missing (with FORCE so a stale one from a
# killed run can't wedge the CREATE).
#
# DATABASE_URL (the docstring's documented invocation) overrides the target:
# before this, the URL was hardcoded here so a documented run on another host
# was a silent no-op that benchmarked the dev database anyway.
_PERF_DB_NAME = "xblog_perf"
_MAINTENANCE_URL = "postgresql+psycopg2://postgres:postgres@10.112.9.49:13310/postgres"
ENGINE_URL = f"postgresql+psycopg2://postgres:postgres@10.112.9.49:13310/{_PERF_DB_NAME}"
if "DATABASE_URL" in os.environ:
    ENGINE_URL = os.environ["DATABASE_URL"]
    # Derive the database-creating maintenance connection from the same
    # host/credentials, pointing at the server's maintenance DB ('postgres').
    _url = ENGINE_URL.rsplit("/", 1)[0]
    _MAINTENANCE_URL = f"{_url}/postgres"
    _PERF_DB_NAME = ENGINE_URL.rsplit("/", 1)[-1]


def _ensure_database_exists() -> None:
    """Create the scratch perf DB if missing (self-bootstrapping).

    The migration docstring points operators at this script to reproduce the
    GIN-index measurement, so it should be a one-shot command — not require a
    manual ``createdb`` step that the eager operator forgets and then sees a
    confusing "database does not exist".
    """
    adm = create_engine(_MAINTENANCE_URL, isolation_level="AUTOCOMMIT")
    try:
        with adm.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": _PERF_DB_NAME},
            ).scalar()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{_PERF_DB_NAME}"'))
                print(f"created scratch database {_PERF_DB_NAME}")
    finally:
        adm.dispose()


def main() -> None:
    _ensure_database_exists()
    engine = create_engine(ENGINE_URL, pool_size=5, max_overflow=5)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    Base.metadata.create_all(engine)
    session = Session(engine)
    now = datetime.now(UTC)

    # ---- taxonomy --------------------------------------------------------------------
    cats = [
        "Engineering",
        "Design",
        "Life",
        "TypeScript",
        "Python",
        "PostgreSQL",
        "Rust",
        "Product",
        "Reading",
        "Security",
        "DevOps",
        "Rants",
    ]
    session.add_all(Category(name=c) for c in cats)
    tag_names = [
        "tips",
        "guide",
        "tutorial",
        "review",
        "notes",
        "opinion",
        "deep-dive",
        "beginner",
        "advanced",
        "architecture",
        "performance",
        "testing",
        "frontend",
        "backend",
        "database",
        "async",
        "a11y",
        "docs",
        "tooling",
        "refactor",
        "interview",
        "news",
    ]
    session.add_all(Tag(name=t) for t in tag_names)
    session.flush()
    cat_ids = list(range(1, len(cats) + 1))
    tag_ids = list(range(1, len(tag_names) + 1))

    # ---- authors + readers -------------------------------------------------------------
    session.add_all(
        User(
            username=f"author{i}",
            password="!benchmark-not-a-real-hash!",
            display_name=f"作者{i}",
            role="superuser" if i < 2 else "editor",
            is_superuser=i < 2,
        )
        for i in range(N_USERS)
    )
    session.add_all(
        ReaderAccount(
            email=f"reader{i}@benchmark.invalid",
            password="!benchmark-not-a-real-hash!",
            display_name=f"读者{i}",
        )
        for i in range(N_READERS)
    )
    session.flush()
    author_ids = list(range(1, N_USERS + 1))
    reader_ids = list(range(1, N_READERS + 1))

    session.add_all(Series(title=f"系列 {i}", slug=f"perf-series-{i}") for i in range(N_SERIES))
    session.flush()
    series_ids = list(range(1, N_SERIES + 1))
    session.commit()

    # ---- posts (bulk Core inserts) ------------------------------------------------------
    posts = []
    tag_rows = []
    revisions = []
    for i in range(N_POSTS):
        published = random.random() < 0.92
        published_at = (now - timedelta(days=random.randint(1, 365 * 3))).replace(microsecond=0)
        post = {
            "title": f"Seed Post #{i}: {random.choice(CJK_WORDS)}实践与踩坑",
            "slug": f"perf-post-{i}",
            "content": BODY,
            "excerpt": "基准测试摘要 " + random.choice(CJK_WORDS) * 4,
            "published": published,
            "pinned": published and random.random() < 0.02,
            "publish_at": published_at,
            "created_at": published_at - timedelta(days=random.randint(0, 14)),
            "updated_at": now - timedelta(days=random.randint(0, 60)),
            "category_id": random.choice(cat_ids) if random.random() < 0.9 else None,
            "views": random.randint(0, 50_000),
            "likes": random.randint(0, 2_000),
            "series_id": random.choice(series_ids) if random.random() < 0.18 else None,
            "series_order": random.randint(0, 12),
            "author_id": random.choice(author_ids),
        }
        posts.append(post)
        for tg in random.sample(tag_ids, random.randint(0, min(5, len(tag_ids)))):
            tag_rows.append({"post_id": i + 1, "tag_id": tg})
        if published and random.random() < 0.7:
            revisions.append(
                {
                    "post_id": i + 1,
                    "title": post["title"],
                    "slug": post["slug"],
                    "content": post["content"],
                    "excerpt": post["excerpt"],
                    "category_id": post["category_id"],
                    "series_id": post["series_id"],
                    "created_at": post["created_at"],
                }
            )
    session.execute(Post.__table__.insert(), posts)
    session.execute(post_tags.insert(), tag_rows)
    if revisions:
        session.execute(PostRevision.__table__.insert(), revisions)
    session.commit()
    print(f"posts={N_POSTS} post_tags={len(tag_rows)} revisions={len(revisions)}")

    # ---- comments (single-pass with explicit ids; parent_id resolves in-memory) ---------
    id_counter = 1
    comment_rows = []
    for pid in range(1, N_POSTS + 1):
        roots = []
        for _ in range(random.randint(0, 8)):
            roots.append(id_counter)
            id_counter += 1
        rows_for_post = []
        for cid in roots:
            rows_for_post.append(
                {
                    "id": cid,
                    "post_id": pid,
                    "parent_id": None,
                    "nickname": random.choice(BODIES)[:8],
                    "content": random.choice(BODIES) * random.randint(1, 6),
                    "is_approved": random.random() < 0.96,
                    "likes": random.randint(0, 40),
                    "created_at": (now - timedelta(days=random.randint(0, 365 * 3))).replace(microsecond=0),
                    "reader_id": random.choice(reader_ids) if random.random() < 0.7 else None,
                }
            )
        for _ in range(len(roots) * 2):
            if id_counter > N_COMMENTS:
                break
            parent = random.choice(rows_for_post)
            rows_for_post.append(
                {
                    "id": id_counter,
                    "post_id": pid,
                    "parent_id": parent["id"],
                    "nickname": random.choice(BODIES)[:8],
                    "content": random.choice(BODIES) * random.randint(1, 6),
                    "is_approved": random.random() < 0.96,
                    "likes": random.randint(0, 40),
                    "created_at": (now - timedelta(days=random.randint(0, 365 * 3))).replace(microsecond=0),
                    "reader_id": random.choice(reader_ids) if random.random() < 0.7 else None,
                }
            )
            id_counter += 1
        if id_counter > N_COMMENTS:
            break
        comment_rows.extend(rows_for_post)
    session.execute(Comment.__table__.insert(), comment_rows)
    like_rows = [
        {"comment_id": c["id"], "ip_key": f"10.0.{c['id'] % 250 + 1}.{(c['id'] // 7 + k) % 254 + 1}"}
        for c in comment_rows
        for k in range(random.randint(0, 6))
    ]
    session.execute(CommentLike.__table__.insert(), like_rows)
    session.commit()
    print(f"comments={len(comment_rows)} comment_likes={len(like_rows)}")

    # ---- post_likes joined, views, history, search logs, pages ---------------------------
    plike_rows = [
        {"post_id": pid, "reader_id": reader_ids[(pid + k * 17) % len(reader_ids)]}
        for pid in range(1, N_POSTS + 1)
        for k in range(random.randint(0, 150))
    ]
    session.execute(ReaderPostLike.__table__.insert(), plike_rows)
    view_rows = [
        {"post_id": pid, "day": (now - timedelta(days=pid * 5 + k * 13)).date(), "views": random.randint(0, 900)}
        for pid in range(1, N_POSTS + 1)
        for k in range(random.randint(0, 30))
    ]
    session.execute(PostViewsDaily.__table__.insert(), view_rows)
    hist_rows = [
        {
            "reader_id": rid,
            "post_id": (rid * 37 + k * 211) % N_POSTS + 1,
            "viewed_at": (now - timedelta(days=random.randint(0, 90))).replace(microsecond=0).replace(tzinfo=None),
            "scroll_position": random.randint(0, 12000),
            "scroll_fraction": random.random(),
            "reading_minutes": random.randint(0, 30),
        }
        for rid in reader_ids
        for k in range(random.randint(0, 40))
    ]
    session.execute(ReadingHistory.__table__.insert(), hist_rows)
    terms = ["python", "评论", "缓存", "索引", "database", "rust", "无障碍", "web push", "教程", "类型系统"]
    log_rows = [
        {
            "query": f"{random.choice(terms)}-{i}",
            "count": random.randint(0, 2000),
            "last_searched_at": now.replace(microsecond=0),
        }
        for i in range(3000)
    ]
    session.execute(SearchLog.__table__.insert(), log_rows)
    page_rows = [
        {"title": f"页面 {i}", "slug": f"perf-page-{i}", "content": BODY[:1200], "published": True} for i in range(8)
    ]
    session.execute(Page.__table__.insert(), page_rows)
    session.commit()
    print(
        f"post_likes={len(plike_rows)} views={len(view_rows)} history={len(hist_rows)} logs={len(log_rows)} pages={len(page_rows)}"
    )

    with engine.connect() as c:
        for t in (
            "posts",
            "comments",
            "tags",
            "categories",
            "users",
            "reader_accounts",
            "post_tags",
            "post_views_daily",
        ):
            n = c.execute(text(f"SELECT count(*) FROM {t}")).scalar()
            print(f"  {t}: {n}")
    session.close()
    engine.dispose()


if __name__ == "__main__":
    main()
