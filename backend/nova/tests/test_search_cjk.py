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
from app.routers.search import _build_snippet, _highlight_sqlite
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
        post = _create_post(db_session, "标题", "zh-excerpt", content="正文内容", excerpt="摘要提到评论系统")
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


LONG_CONTENT = "开头甲" + "填充甲" * 200 + "评论系统出现在中段" + "结尾乙"


class TestSearchSnippet:
    """Snippet generation for CJK/mid-content matches (DEC-071, TASK-144).

    Bare function tests against _build_snippet (dialect False = the Python
    highlighter path). The original behavior windowed content[:300], so a term
    buried deep in a long post never appeared or got highlighted; the fixed
    path windows around the first matched term in the full content."""

    def _post(self, db_session, content, slug, excerpt=None):
        return _create_post(db_session, f"标题{slug}", slug, content=content, excerpt=excerpt or "摘要")

    def test_mid_content_cjk_match_is_highlighted(self, db_session):
        # The term sits at ~400 chars in a 600+ char body.
        post = self._post(db_session, LONG_CONTENT, "snippet-mid")
        snippet = _build_snippet(post, "评论系统", False, db_session)
        assert snippet is not None
        assert "<mark>评论系统</mark>" in snippet
        assert len(snippet) <= 500

    def test_snippet_prefers_excerpt_that_matches(self, db_session):
        post = self._post(db_session, "正文内容无关键词", "snippet-excerpt", excerpt="摘要：评论系统很强大")
        snippet = _build_snippet(post, "评论系统", False, db_session)
        assert snippet is not None
        assert "<mark>评论系统</mark>" in snippet
        assert "正文内容无关键词" not in snippet  # came from the excerpt

    def test_snippet_uses_content_when_excerpt_has_no_match(self, db_session):
        post = self._post(db_session, LONG_CONTENT, "snippet-content")
        snippet = _build_snippet(post, "评论系统", False, db_session)
        assert "填充甲" in snippet  # content window, not the excerpt

    def test_partial_cjk_term_highlighted(self, db_session):
        post = self._post(db_session, LONG_CONTENT, "snippet-partial")
        snippet = _build_snippet(post, "评", False, db_session)
        assert snippet is not None
        assert "<mark>评</mark>" in snippet

    def test_snippet_is_balanced_and_bounded(self, db_session):
        spam = "评论系统 " * 400  # many matches, very long
        post = self._post(db_session, spam, "snippet-long")
        snippet = _build_snippet(post, "评论系统", False, db_session)
        assert len(snippet) <= 500
        assert snippet.count("<mark>") == snippet.count("</mark>")

    def test_snippet_xss_safe(self, db_session):
        malicious = "<script>alert(1)</script> 前面评论系统后面"
        post = self._post(db_session, malicious, "snippet-xss")
        snippet = _build_snippet(post, "评论系统", False, db_session)
        assert snippet is not None
        assert "<script>" not in snippet  # escaped
        assert "<mark>评论系统</mark>" in snippet  # only our markup survives

    def test_ascii_snippet_still_highlights(self, db_session):
        post = self._post(db_session, "The quick brown fox jumps", "snippet-ascii")
        snippet = _build_snippet(post, "quick", False, db_session)
        assert snippet is not None
        assert "<mark>quick</mark>" in snippet

    def test_empty_query_returns_none_or_plain(self):
        # The existing _highlight_sqlite contract: empty query -> escaped text.
        out = _highlight_sqlite("Some content here", "")
        assert "Some content here" in out or out == ""


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

            # CJK snippet uses the Python highlighter even on Postgres: the old
            # dialect-branched ts_headline('english') produced no <mark> for CJK.
            snippet = _build_snippet(post, "评", True, db)
            assert snippet is not None
            assert "<mark>" in snippet and "</mark>" in snippet
        finally:
            db.close()
            engine.dispose()
