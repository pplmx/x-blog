"""Search-term suggestions ("did you mean") contract + unit tests (DEC-443).

The post search is exact substring / tsvector — no fuzzy layer — so a
misspelled or half-remembered term dead-ends on a zero-hit page. The
suggest endpoint scores a bounded vocabulary (tag/category names + recent
public post titles) with plain Python edit distance. Key properties:

- Pure scorer is code-point based → CJK one-character typos score exactly like
  ASCII ones (dialect-parity-free; no Postgres extension).
- Zero-hit tags/categories (only draft/scheduled posts) are never offered.
- Post titles come from PUBLIC posts only (published + effective-publish
  passed) and are bounded to the newest N.
- Exact-match and noise queries return no suggestions.
- Whitespace-only q is a 422 (same boundary guard as /api/search).
"""

from datetime import UTC, datetime, timedelta

from app import models, schemas
from app.crud import create_post
from app.suggest import (
    SUGGEST_MIN_SCORE,
    build_search_vocabulary,
    levenshtein,
    score_candidate,
    should_suggest,
)

BASE = "/api/search/suggest"


# ---------------------------------------------------------------------------
# Pure scorer units (no DB): the thresholds are testable in isolation.
# ---------------------------------------------------------------------------


class TestLevenshtein:
    def test_identity_and_empty(self):
        assert levenshtein("abc", "abc") == 0
        assert levenshtein("", "") == 0
        assert levenshtein("", "abc") == 3

    def test_single_edit_cases(self):
        assert levenshtein("kitten", "sitten") == 1  # substitution
        assert levenshtein("kitten", "sitting") == 3  # classic

    def test_cjk_one_character(self):
        # One substituted Chinese character = exactly one edit (code-point
        # based, no byte-length skew).
        assert levenshtein("响应试", "响应式") == 1

    def test_cjk_transposition_like(self):
        # Two-char CJK swap scores like an ASCII transposition.
        assert levenshtein("类型转换", "类转型换") == 2


class TestScoreCandidate:
    def test_ascii_typo_clears_threshold(self):
        assert score_candidate("javascrit", "Javascript") >= SUGGEST_MIN_SCORE

    def test_cjk_typo_clears_threshold(self):
        assert score_candidate("响应试", "响应式") >= SUGGEST_MIN_SCORE

    def test_multi_word_term_coverage_beats_full_distance(self):
        # "web design" vs a long title: every token appears, so the
        # term-coverage path rescues a diluted full-string distance.
        score = score_candidate("web design", "Responsive Web Design and Accessibility")
        assert score >= SUGGEST_MIN_SCORE

    def test_exact_match_is_perfect(self):
        assert score_candidate("python", "python") == 1.0

    def test_noise_query_below_threshold(self):
        assert score_candidate("zzzq", "python") < SUGGEST_MIN_SCORE
        assert score_candidate("aaaa", "bbbb") < SUGGEST_MIN_SCORE


class TestShouldSuggest:
    def _passes(self, q: str, c: str) -> bool:
        return should_suggest(q, c, score_candidate(q, c))

    def test_two_char_cjk_typo_is_caught(self):
        # The canonical Chinese typo: one substituted character in a 2-char
        # word is only 0.5 similarity — a plain ratio floor would miss it.
        assert self._passes("前段", "前端")

    def test_three_char_cjk_typo_is_caught(self):
        assert self._passes("响应试", "响应式")

    def test_ascii_typo_is_caught(self):
        assert self._passes("javascrit", "Javascript")

    def test_one_char_query_never_suggests(self):
        # "a" is too ambiguous to recover — must not spray every a-word.
        assert not self._passes("a", "abc")
        assert not self._passes("a", "家里")

    def test_disjoint_short_pair_is_noise(self):
        assert not self._passes("ab", "cd")

    def test_moderately_typoed_cjk_title_still_recovers(self):
        # 2 of 7 chars wrong nets 0.5 normalized — permissive floor keeps the
        # recovery path open for realistic title typos.
        assert self._passes("响应是设计", "响应式设计入门")


# ---------------------------------------------------------------------------
# Vocabulary & endpoint contracts (DB-backed).
# ---------------------------------------------------------------------------


def _seed_blog(db_session):
    """Two posts with taxonomy across two categories/tags, one draft-only tag."""
    tech = models.Category(name="技术")
    life = models.Category(name="生活")
    db_session.add_all([tech, life])
    py_tag = models.Tag(name="python")
    draft_tag = models.Tag(name="草稿话题")
    db_session.add_all([py_tag, draft_tag])
    db_session.flush()

    p1 = create_post(
        db_session,
        schemas.PostCreate(title="python 异步实践", slug="py-async", content="# python 异步", published=True),
    )
    p1.category = tech
    p1.tags = [py_tag]
    p1.created_at = datetime.now(UTC) - timedelta(days=3)

    p2 = create_post(
        db_session,
        schemas.PostCreate(title="响应式设计入门", slug="responsive", content="# 响应式设计", published=True),
    )
    p2.category = tech
    p2.created_at = datetime.now(UTC)
    db_session.flush()
    return {"p1": p1, "p2": p2, "py_tag": py_tag, "draft_tag": draft_tag}


class TestVocabulary:
    def test_taxonomy_and_titles_entered(self, client, db_session):
        _seed_blog(db_session)
        vocab = build_search_vocabulary(db_session)
        texts = {v["text"].lower(): v for v in vocab}
        assert "python" in texts and texts["python"]["kind"] == "tag"
        assert "技术" in texts and texts["技术"]["kind"] == "category"
        assert "响应式设计入门" in texts and texts["响应式设计入门"]["kind"] == "post"

    def test_zero_hit_taxonomy_and_drafts_excluded(self, client, db_session):
        # draft_tag has no PUBLIC post; nothing with it may be suggested and
        # post titles only come from published posts.
        _seed_blog(db_session)
        vocab = build_search_vocabulary(db_session)
        texts = {v["text"].lower(): v for v in vocab}
        assert "草稿话题" not in texts
        assert "python" in texts  # published tag stays
        assert texts["python"]["hits"] == 1  # only p1 carries it

    def test_vocabulary_bounded_title_count(self, client, db_session):
        # Seed more post titles than the vocab cap; the fetch must not return
        # them all (bounded memory/latency on the suggest path).
        for i in range(180):
            create_post(
                db_session,
                schemas.PostCreate(title=f"批量文章 {i:03d}", slug=f"bulk-{i}", content="# x", published=True),
            )
        db_session.flush()
        vocab = build_search_vocabulary(db_session)
        titles = [v for v in vocab if v["kind"] == "post"]
        assert len(titles) <= 150


class TestSuggestEndpoint:
    def test_ascii_typo_returns_tag_suggestion(self, client, db_session):
        _seed_blog(db_session)
        resp = client.get(BASE, params={"q": "pythn"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["query"] == "pythn"
        assert any(s["text"].lower() == "python" for s in body["suggestions"])

    def test_cjk_typo_returns_category_suggestion(self, client, db_session):
        _seed_blog(db_session)
        # "机" is one edit from "技" — the canonical 2-char CJK category typo.
        resp = client.get(BASE, params={"q": "机术"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert any(s["text"] == "技术" for s in body["suggestions"])
        assert all(s["hits"] > 0 for s in body["suggestions"])

    def test_title_typo_suggests_the_post(self, client, db_session):
        _seed_blog(db_session)
        resp = client.get(BASE, params={"q": "响应式设计门"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert any(s["text"] == "响应式设计入门" for s in body["suggestions"])

    def test_no_suggestions_for_noise(self, client, db_session):
        _seed_blog(db_session)
        resp = client.get(BASE, params={"q": "zzzzzzzz"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["suggestions"] == []

    def test_exact_match_is_not_a_suggestion(self, client, db_session):
        # If the query already matches a vocabulary term, there is nothing to
        # suggest (real results exist).
        _seed_blog(db_session)
        resp = client.get(BASE, params={"q": "python"})
        assert resp.status_code == 200, resp.text
        assert all(s["text"].lower() != "python" for s in resp.json()["suggestions"])

    def test_limit_bounds(self, client, db_session):
        _seed_blog(db_session)
        # "python 异步" matches both the tag and the title — limit must cap it.
        resp = client.get(BASE, params={"q": "python 异步", "limit": 2})
        assert resp.status_code == 200, resp.text
        assert 1 <= len(resp.json()["suggestions"]) <= 2

    def test_whitespace_query_is_422(self, client, db_session):
        resp = client.get(BASE, params={"q": "   "})
        assert resp.status_code == 422

    def test_max_length_cap(self, client, db_session):
        resp = client.get(BASE, params={"q": "x" * 201})
        assert resp.status_code == 422

    def test_draft_only_tag_never_suggested_even_close(self, client, db_session):
        # "草稿话题" has zero public posts → excluded by build_search_vocabulary;
        # a near-query must not resurrect it.
        _seed_blog(db_session)
        resp = client.get(BASE, params={"q": "草稿话题"})
        assert resp.status_code == 200, resp.text
        assert all(s["text"] != "草稿话题" for s in resp.json()["suggestions"])
