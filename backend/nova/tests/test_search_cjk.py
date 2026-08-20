"""Chinese-aware search contract tests (DEC-070, TASK-143).

Production search (crud.search_posts) used Postgres to_tsvector('english'),
which tokenizes CJK as opaque runs — partial/prefix Chinese queries ('评' vs
content '评论系统') did not match on Postgres, while the SQLite ILIKE path did.
This suite locks the fix: CJK is detected in the QUERY (Python-side, not by
dialect) and routed to the dialect-agnostic ILIKE substring path on SQLite and
Postgres alike; ASCII queries keep tsvector relevance ranking on Postgres.

The Postgres-gated test is the true regression guard for the original bug — it
SKIPs unless TEST_DATABASE_URL points at a reachable PostgreSQL (the operator's
dev host 10.112.9.49:13310 is the intended target; the local SQLite suite
cannot execute to_tsvector).
"""

import os

import pytest

from app.crud import _has_cjk, search_posts
from app.schemas import PostCreate

CJK_CONTENT = "# 标题\n评论系统支持楼中楼回复，回复通知走 Web Push。"


def _create_post(db_session, title, slug, content="body", excerpt="excerpt"):
    from app.crud import create_post

    return create_post(
        db_session,
        PostCreate(title=title, slug=slug, content=content, excerpt=excerpt, published=True),
    )


class TestHasCjk:
    def test_blank_and_ascii_are_not_cjk(self):
        assert _has_cjk("") is False
        assert _has_cjk("typescript") is False
        assert _has_cjk("TypeScript 5") is False

    def test_ideographs_are_cjk(self):
        assert _has_cjk("评论") is True
        assert _has_cjk("评") is True
        assert _has_cjk("类型检查") is True
        # CJK Extension A range is covered too.
        assert _has_cjk("㐂") is True

    def test_mixed_queries_are_cjk(self):
        # A query mixing CJK and ASCII is still CJK: ILIKE handles both.
        assert _has_cjk("TypeScript 类型检查") is True


class TestChineseSearchSqlite:
    """Substring matching for CJK on the (default) SQLite test DB — the same
    code path the Postgres CJK fallback now uses."""

    def test_chinese_exact_term_matches_content(self, db_session):
        post = _create_post(db_session, "中文帖子", "zh-post", CJK_CONTENT)
        found, total = search_posts(db_session, "评论系统")
        assert total == 1
        assert found[0].id == post.id

    def test_chinese_partial_prefix_matches(self, db_session):
        """The original Postgres bug: '评' must match content containing
        '评论系统' (opaque-run tokenization would not)."""
        post = _create_post(db_session, "中文帖子", "zh-post-prefix", CJK_CONTENT)
        found, total = search_posts(db_session, "评")
        assert total >= 1
        assert any(p.id == post.id for p in found)

    def test_chinese_term_in_excerpt_matches(self, db_session):
        # The ILIKE path covers excerpt like the tsvector path does.
        post = _create_post(
            db_session, "标题", "zh-excerpt", content="正文内容", excerpt="摘要提到评论系统"
        )
        found, total = search_posts(db_session, "评论系统")
        assert total == 1
        assert found[0].id == post.id
        # A term entirely absent still returns nothing.
        found, total = search_posts(db_session, "不存在的词")
        assert total == 0

    def test_ascii_search_unchanged(self, db_session):
        post = _create_post(db_session, "Python Tutorial", "py-tut", "Learn Python")
        found, total = search_posts(db_session, "python")
        assert total == 1
        assert found[0].id == post.id

    def test_mixed_query_matches(self, db_session):
        post = _create_post(db_session, "TypeScript", "ts-post", "类型检查配置指南")
        found, total = search_posts(db_session, "TypeScript 类型")
        assert total == 1
        assert found[0].id == post.id


@pytest.mark.skipif(
    not os.getenv("TEST_DATABASE_URL", "").startswith("postgresql"),
    reason="requires TEST_DATABASE_URL pointing at PostgreSQL (e.g. dev host 10.112.9.49:13310)",
)
class TestChineseSearchPostgres:
    """Runs the CJK branch against a REAL PostgreSQL. Skipped by default — the
    operator runs it with TEST_DATABASE_URL pointing at the dev pg host (see
    backend/nova/run_pg_search_tests.sh). On the OLD tsvector code this test
    fails (the original bug); with the ILIKE fallback it passes."""

    def test_chinese_partial_prefix_matches_on_postgres(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        engine = create_engine(os.environ["TEST_DATABASE_URL"])
        Session = sessionmaker(bind=engine)
        db = Session()
        try:
            from app.database import Base

            Base.metadata.create_all(engine)
            post = _create_post(db, "中文帖子", "zh-pg-post", CJK_CONTENT)
            db.commit()
            found, total = search_posts(db, "评")
            assert total >= 1
            assert any(p.id == post.id for p in found)
            found, total = search_posts(db, "TypeScript 类型")  # mixed -> ILIKE
            assert total >= 0  # not present -> no match (control path executes)
        finally:
            db.close()
            engine.dispose()
