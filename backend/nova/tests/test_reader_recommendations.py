"""Personalized 'Recommended for you' contract tests (DEC-128, TASK-176).

GET /api/reader/me/recommendations returns public posts scored by the signed-in
reader's category/tag affinity (from reading history + bookmarks), excluding
posts they have already read or bookmarked, capped and stably ordered. Cold
start (no interests) yields an empty list; results are isolated per reader.
"""

RECOMMEND = "/api/reader/me/recommendations"
HISTORY = "/api/reader/me/history"
BOOKMARKS = "/api/reader/me/bookmarks"


def _register(client, email="rec@example.com", password="readerpass123"):
    return client.post("/api/reader/register", json={"email": email, "password": password})


def _token(client, email="rec@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _category(db, name):
    from app.models import Category

    c = db.query(Category).filter(Category.name == name).first()
    if not c:
        c = Category(name=name)
        db.add(c)
        db.commit()
        db.refresh(c)
    return c


def _post(db, title, category=None, tags=(), published=True):
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return create_post(
        db,
        PostCreate(
            title=title,
            slug=f"rec-post-{_slug_counter}",
            content="# Hello\n\nWorld",
            category_id=category.id if category else None,
            tags=list(tags),
            published=published,
        ),
    )


def _read(client, token, post_id):
    return client.post(f"{HISTORY}/{post_id}", headers=_auth(token))


def _bookmark(client, token, post_id):
    return client.put(f"{BOOKMARKS}/{post_id}", headers=_auth(token))


def _recs(client, token, **params):
    resp = client.get(RECOMMEND, params=params, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestAuthRequired:
    def test_recommendations_require_reader_token(self, client):
        assert client.get(RECOMMEND).status_code == 401

    def test_admin_token_rejected(self, client, admin_token):
        resp = client.get(RECOMMEND, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 401


class TestRecommendations:
    def test_cold_start_empty(self, client, db_session):
        token = _token(client)
        _post(db_session, "Any", category=_category(db_session, "AI"))
        assert _recs(client, token) == []

    def test_category_affinity_excludes_read(self, client, db_session):
        token = _token(client)
        ai = _category(db_session, "AI")
        dev = _category(db_session, "DevOps")
        a1 = _post(db_session, "A1", category=ai)
        a2 = _post(db_session, "A2", category=ai)
        b1 = _post(db_session, "B1", category=dev)
        b2 = _post(db_session, "B2", category=dev)
        _read(client, token, a1.id)

        recs = _recs(client, token)
        slugs = [r["slug"] for r in recs]
        # Only the same-category unread post is recommended.
        assert slugs == [a2.slug]
        assert a1.slug not in slugs  # excluded: already read
        assert b1.slug not in slugs and b2.slug not in slugs  # no affinity

    def test_excludes_bookmarked_posts(self, client, db_session):
        token = _token(client)
        ai = _category(db_session, "AI")
        source = _post(db_session, "Source", category=ai)
        candidate = _post(db_session, "Candidate", category=ai)
        bookmarked = _post(db_session, "Bookmarked", category=ai)
        _read(client, token, source.id)
        _bookmark(client, token, bookmarked.id)

        slugs = [r["slug"] for r in _recs(client, token)]
        assert candidate.slug in slugs
        assert bookmarked.slug not in slugs  # excluded: already bookmarked

    def test_tag_affinity(self, client, db_session):
        token = _token(client)
        source = _post(db_session, "Source", tags=["python"])
        other = _post(db_session, "Other", tags=["python"])
        unrelated = _post(db_session, "Unrelated", tags=["go"])
        _read(client, token, source.id)

        slugs = [r["slug"] for r in _recs(client, token)]
        assert other.slug in slugs
        assert unrelated.slug not in slugs
        assert source.slug not in slugs

    def test_cap_and_order(self, client, db_session):
        token = _token(client)
        ai = _category(db_session, "AI")
        source = _post(db_session, "Source", category=ai)
        posts = [_post(db_session, f"C{i}", category=ai) for i in range(4)]
        _read(client, token, source.id)

        recs = _recs(client, token, limit=2)
        assert len(recs) == 2

        all_recs = _recs(client, token)
        assert len(all_recs) == 4
        # Recency ordering (newest first), all same affinity.
        rev = [p.slug for p in reversed(posts)]
        assert [r["slug"] for r in all_recs] == rev

    def test_isolated_between_readers(self, client, db_session):
        ai = _category(db_session, "AI")
        dev = _category(db_session, "DevOps")
        a1 = _post(db_session, "AI1", category=ai)
        a2 = _post(db_session, "AI2", category=ai)
        d1 = _post(db_session, "DEV1", category=dev)
        d2 = _post(db_session, "DEV2", category=dev)

        t1 = _token(client, email="rec1@example.com")
        t2 = _token(client, email="rec2@example.com")
        _read(client, t1, a1.id)
        _read(client, t2, d1.id)

        assert [r["slug"] for r in _recs(client, t1)] == [a2.slug]
        assert [r["slug"] for r in _recs(client, t2)] == [d2.slug]
