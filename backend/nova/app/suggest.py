"""Search-term suggestions ("did you mean") for the public search.

A reader who misspells or half-remembers a term ("recatvie", "响应试") gets a
zero-hit page with no recovery path: the post search is exact substring +
tsvector, with no fuzzy layer (round-390 gap analysis, DEC-443). This module
fills the dead-end by scoring a small vocabulary of canonical topics — tag
names, category names, and recent public post titles — with plain Python
edit distance.

Why not a Postgres trigram/Levenshtein extension: the repo enforces strict
PG/SQLite + CJK/ASCII dialect parity everywhere (DEC-071 and friends), and the
edit distance works on code points, so a Chinese one-character typo
("响应试" → "响应式") scores exactly like an ASCII one. Computing in Python
against a bounded vocabulary also keeps the suggestion latency off the hot
`/api/search` path — the suggest endpoint is only ever reached after a page
already returned zero hits.

The module is deliberately DB-light: the only SQL is the bounded recent-title
fetch; tag/category vocab comes from the same cached list helpers the tags/
categories APIs serve.
"""

from sqlalchemy import or_
from sqlalchemy.orm import Session

from . import crud, models

# Minimum normalized similarity for a candidate to be offered. 0.5 admits a
# single-edit miss even in a short CJK term (2-char "前段" → "前端" is 0.5),
# which is THE canonical Chinese typo; the distance-based short-string guard
# below keeps genuine noise ("ab" → "cd") out while this floor stays permissive.
# Random long strings sit well under it ("设计模式" vs "装饰模式" is 0.33).
SUGGEST_MIN_SCORE = 0.5
# Terms this short are guarded by ABSOLUTE edit distance (≤ 1), not just the
# ratio — a 1-edit neighbor at 2-3 code points is a loud signal, and a bare
# ratio would let 1-char queries spray suggestions everywhere.
SHORT_TERM_LEN = 3
# Upper bound on how many recent post titles enter the vocabulary. Titles are
# the largest source; 150 recent ones cover "I half-remember the title" far
# better than the marginal cost of scanning thousands.
VOCAB_TITLE_LIMIT = 150
# Default/API cap for the number of suggestions returned per query.
SUGGEST_LIMIT = 4


def levenshtein(a: str, b: str) -> int:
    """Classic two-row DP edit distance over Python code points.

    Being code-point based it is CJK-correct for free: a substituted Chinese
    character is one edit, exactly like an ASCII one (no byte-length skew).
    """
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * lb
        for j, cb in enumerate(b, 1):
            cur[j] = min(
                prev[j] + 1,  # deletion
                cur[j - 1] + 1,  # insertion
                prev[j - 1] + (0 if ca == cb else 1),  # substitution
            )
        prev = cur
    return prev[lb]


def score_candidate(query: str, candidate: str) -> float:
    """Normalized similarity of a query against one vocabulary candidate.

    Returns a float in [0, 1]: 1 - edit_distance / max_len for the whole
    string, falling back to a term-coverage bonus when the query has multiple
    whitespace terms and the candidate is long (full-string distance dilutes
    fast on long titles even when every term matches). Ranking only — pass/fail
    lives in ``should_suggest``. Pure — no I/O — so thresholds are
    unit-testable without a database.
    """
    q = query.strip().lower()
    c = candidate.strip().lower()
    if not q or not c:
        return 0.0
    if q == c:
        return 1.0
    full = 1.0 - levenshtein(q, c) / max(len(q), len(c))
    terms = q.split()
    if len(terms) > 1:
        hit = sum(1 for t in terms if t in c)
        term_ratio = hit / len(terms)
        full = max(full, term_ratio * 0.85)
    return full


def should_suggest(query: str, candidate: str, score: float) -> bool:
    """Whether ``score`` is strong enough to offer this candidate.

    Length-aware: a 1-edit miss in short terms is a strong signal even at a
    low ratio (the 2-char CJK typo "前段" → "前端"), so short strings demand
    an ABSOLUTE distance ≤ 1; longer strings just need the ratio floor. A
    one-character query is too ambiguous to ever suggest (avoids "a" →
    every-a-word spray)."""
    q = query.strip().lower()
    c = candidate.strip().lower()
    if not q or not c:
        return False
    if len(q) < 2 or len(c) < 2:
        return False
    if min(len(q), len(c)) <= SHORT_TERM_LEN:
        return levenshtein(q, c) <= 1 and score >= SUGGEST_MIN_SCORE
    return score >= SUGGEST_MIN_SCORE


def build_search_vocabulary(db: Session) -> list[dict]:
    """The canonical topics a reader might type: tags, categories, post titles.

    Each entry is ``{"text", "kind", "hits"}`` where ``hits`` is the count of
    PUBLICLY VISIBLE posts that would actually match the term (so a zero-hit
    tag/category — a draft-only topic — is never offered as a live suggestion).
    """
    vocab: list[dict] = []

    # Tag/category names with their public post counts — the payloads the tags
    # and categories APIs already serve (cached; ISS-362 guards count the
    # published+effective-publish-passed posts that a tag listing returns).
    for tag in crud.get_tags(db):
        if tag["post_count"] > 0:
            vocab.append({"text": tag["name"], "kind": "tag", "hits": tag["post_count"]})
    for cat in crud.get_categories(db):
        if cat["post_count"] > 0:
            vocab.append({"text": cat["name"], "kind": "category", "hits": cat["post_count"]})

    # Bounded recent POST TITLES (titles only — no content leaves the DB, and
    # every row is public: published + effective publish time passed). Ordered
    # newest-first exactly like the home list so the freshest topics win ties.
    now = crud.utc_now_naive()
    rows = (
        db.query(models.Post.title)
        .filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .order_by(crud._effective_publish_col().desc(), models.Post.id.desc())
        .limit(VOCAB_TITLE_LIMIT)
        .all()
    )
    for (title,) in rows:
        if title:
            vocab.append({"text": title, "kind": "post", "hits": 1})

    return vocab


def suggest_terms(db: Session, query: str, limit: int = 4) -> list[dict]:
    """Top ``limit`` candidate terms closest to ``query``, best first.

    Excludes the query itself (an exact match is real results, not a
    suggestion), deduplicates identical texts (a topic that is both a tag and
    a post title surfaces once), and stops at the score floor so a nonsense
    query returns an empty list instead of noise.
    """
    if not query or not query.strip():
        return []
    best: list[tuple[float, dict]] = []
    seen: set[str] = set()
    ql = query.strip().lower()
    for cand in build_search_vocabulary(db):
        score = score_candidate(query, cand["text"])
        if not should_suggest(query, cand["text"], score):
            continue
        if cand["text"].lower() == ql:
            continue  # exact match = already-searchable, not a suggestion
        key = cand["text"].lower()
        if key in seen:
            # Same text at equal score: keep the earlier source so taxonomy
            # (tags/categories, with richer hit counts) beats a post title.
            continue
        seen.add(key)
        best.append((score, cand))
    best.sort(key=lambda pair: (-pair[0], -pair[1]["hits"]))
    return [cand for _, cand in best[:limit]]
