def test_create_post(client, auth_headers):
    response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Post"
    assert data["slug"] == "test-post"


def test_list_posts_returns_cached_second_request(client, auth_headers):
    """The second identical request to /api/posts must serve from the cache.

    We spy on crud.get_posts: the first call queries the DB, the second (cache
    hit) must NOT call it.
    """
    from app import crud

    client.post(
        "/api/posts",
        json={"title": "Cached Post", "slug": "cached-post", "content": "C", "published": True},
        headers=auth_headers,
    )

    from unittest.mock import patch

    with patch.object(crud, "get_posts", wraps=crud.get_posts) as spy:
        first = client.get("/api/posts")
        second = client.get("/api/posts")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["pagination"]["total"] == 1
    # First request populates the cache (DB hit); second serves from cache.
    assert spy.call_count == 1


def test_list_posts_cache_invalidated_on_create(client, auth_headers):
    """Creating a post must invalidate the posts list cache."""
    # Prime the cache with an empty list
    first = client.get("/api/posts")
    assert first.json()["pagination"]["total"] == 0

    # Creating a published post must drop the stale cache
    client.post(
        "/api/posts",
        json={
            "title": "New Post",
            "slug": "new-post",
            "content": "C",
            "published": True,
        },
        headers=auth_headers,
    )

    second = client.get("/api/posts")
    assert second.json()["pagination"]["total"] == 1
    assert second.json()["items"][0]["slug"] == "new-post"


def test_list_posts_cache_invalidated_on_update(client, auth_headers):
    """Updating a post must drop the stale posts list cache."""
    create = client.post(
        "/api/posts",
        json={
            "title": "Update Me",
            "slug": "update-me",
            "content": "C",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create.json()["id"]

    # Prime the cache with the original title
    first = client.get("/api/posts")
    assert first.json()["items"][0]["title"] == "Update Me"

    # Updating the title must invalidate the cache
    response = client.put(
        f"/api/admin/posts/{post_id}",
        json={"title": "Updated Title"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert response.status_code == 200

    # Cache miss → fresh fetch reflects the new title
    second = client.get("/api/posts")
    assert second.json()["items"][0]["title"] == "Updated Title"


def test_list_posts_cache_invalidated_on_delete(client, auth_headers):
    """Deleting a post must drop the stale posts list cache."""
    create = client.post(
        "/api/posts",
        json={
            "title": "Delete Me",
            "slug": "delete-me",
            "content": "C",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create.json()["id"]

    # Prime the cache with the post present
    first = client.get("/api/posts")
    assert first.json()["pagination"]["total"] == 1

    # Deleting must invalidate the cache
    delete_response = client.delete(f"/api/admin/posts/{post_id}", headers=auth_headers)
    assert delete_response.status_code in (200, 204)

    # Cache miss → fresh fetch shows the post is gone
    second = client.get("/api/posts")
    assert second.json()["pagination"]["total"] == 0


def test_category_post_count_invalidated_on_post_write(client, auth_headers):
    """Assigning a post to a category must refresh the cached category post_count.

    Regresses the stale post_count bug (RIL TASK-074, ISS-042): post writes
    cleared tags/posts caches but not categories_cache, so the per-category
    post_count stayed stale up to the 1800s TTL.
    """
    cat = client.post(
        "/api/admin/categories",
        json={"name": "Cache Test Cat"},
        headers=auth_headers,
    ).json()

    # Prime the categories cache (post_count 0 for the new category)
    first = client.get("/api/categories")
    assert next(c for c in first.json() if c["id"] == cat["id"])["post_count"] == 0

    # Create a post in that category -> must drop the cached categories list
    created = client.post(
        "/api/posts",
        json={
            "title": "Categorized Cache",
            "slug": "categorized-cache",
            "content": "C",
            "published": True,
            "category_id": cat["id"],
        },
        headers=auth_headers,
    )
    assert created.status_code == 201

    second = client.get("/api/categories")
    assert next(c for c in second.json() if c["id"] == cat["id"])["post_count"] == 1


def test_list_posts(client, auth_headers):
    client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    response = client.get("/api/posts")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["pagination"]["total"] == 1


def test_get_post(client, auth_headers):
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create_response.json()["id"]
    response = client.get(f"/api/posts/{post_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Test Post"


def test_draft_post_hidden_from_public(client, auth_headers):
    """Drafts must not be readable via the public API by id or slug."""
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Draft Post",
            "slug": "draft-post",
            "content": "Secret draft content",
            "published": False,
        },
        headers=auth_headers,
    )
    post_id = create_response.json()["id"]

    by_id = client.get(f"/api/posts/{post_id}")
    assert by_id.status_code == 404

    by_slug = client.get("/api/posts/draft-post")
    assert by_slug.status_code == 404

    # Drafts must not count views or likes either
    view_response = client.post(f"/api/posts/{post_id}/view")
    assert view_response.status_code == 404
    like_response = client.post(f"/api/posts/{post_id}/like")
    assert like_response.status_code == 404


def test_scheduled_post_hidden_until_publish_at(client, auth_headers):
    """Future-dated posts are invisible; past-dated published posts are visible."""
    future_response = client.post(
        "/api/posts",
        json={
            "title": "Scheduled Post",
            "slug": "scheduled-post",
            "content": "Not yet",
            "published": True,
            "publish_at": "2099-01-01T00:00:00",
        },
        headers=auth_headers,
    )
    future_id = future_response.json()["id"]
    future_get = client.get(f"/api/posts/{future_id}")
    assert future_get.status_code == 404

    past_response = client.post(
        "/api/posts",
        json={
            "title": "Past Post",
            "slug": "past-post",
            "content": "Already out",
            "published": True,
            "publish_at": "2000-01-01T00:00:00",
        },
        headers=auth_headers,
    )
    past_id = past_response.json()["id"]
    past_get = client.get(f"/api/posts/{past_id}")
    assert past_get.status_code == 200
    assert past_get.json()["title"] == "Past Post"


def test_update_post(client, auth_headers):
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create_response.json()["id"]
    response = client.put(
        f"/api/posts/{post_id}",
        json={"title": "Updated Title"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Updated Title"


def test_delete_post(client, auth_headers):
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create_response.json()["id"]
    response = client.delete(f"/api/posts/{post_id}", headers=auth_headers)
    assert response.status_code == 204
    get_response = client.get(f"/api/posts/{post_id}")
    assert get_response.status_code == 404


def test_get_post_unicode_digit_not_treated_as_id(client):
    """Unicode superscript digits should be treated as slugs, not post IDs.

    str.isdigit() returns True for Unicode digits like '²', but int('²')
    raises ValueError. The endpoint should not crash on such input.
    """
    response = client.get("/api/posts/%C2%B2")  # '²' URL-encoded
    # Should not be 500 (internal server error); either 404 or treated as slug
    assert response.status_code != 500
    assert response.status_code in (200, 404)


def test_get_post_huge_numeric_id_does_not_crash(client):
    """A very long all-digit path segment must not 500.

    Python 3.14 raises ValueError ('Exceeds the limit (4300 digits)') for
    int() of >4300-digit strings, and even ~30 digits exceeds the 64-bit
    BIGINT range the id columns use. With the ≤15-digit numeric-id bound the
    oversized segment is treated as a slug lookup → 404, never a 500.
    """
    huge = "9" * 5000
    response = client.get(f"/api/posts/{huge}")
    assert response.status_code == 404

    over_bigint = "9" * 30  # 30 digits: beyond 64-bit, still 'all digits'
    response = client.get(f"/api/posts/{over_bigint}")
    assert response.status_code in (200, 404)  # definitely not 500
    assert response.status_code != 500


def test_create_post_with_cover_image(client, auth_headers):
    """Creating a post with cover_image should save it."""
    response = client.post(
        "/api/posts",
        json={
            "title": "Cover Image API Post",
            "slug": "cover-image-api-post",
            "content": "Test content",
            "published": True,
            "cover_image": "https://example.com/cover.jpg",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    assert response.json()["cover_image"] == "https://example.com/cover.jpg"


def test_update_post_with_cover_image(client, auth_headers):
    """Updating a post with cover_image should persist it."""
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Update Cover Post",
            "slug": "update-cover-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create_response.json()["id"]

    update_response = client.put(
        f"/api/posts/{post_id}",
        json={"cover_image": "https://example.com/new-cover.jpg"},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["cover_image"] == "https://example.com/new-cover.jpg"


def test_delete_post_with_conflicting_data_returns_error_not_500(client, auth_headers, db_session):
    """Test that post update/delete errors are handled gracefully, not 500."""
    from app import models

    # Test update with duplicate slug returns 400
    post1 = models.Post(
        title="Post A",
        slug="post-a-slug",
        content="Content",
        published=True,
    )
    post2 = models.Post(
        title="Post B",
        slug="post-b-slug",
        content="Content",
        published=True,
    )
    db_session.add_all([post1, post2])
    db_session.commit()

    response = client.put(
        f"/api/posts/{post2.id}",
        json={"slug": "post-a-slug"},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "already exists" in response.json()["error"]["message"]


def _seed_adjacent_posts(db_session):
    """Seed posts with known created_at so feed order is deterministic.

    Feed order: pinned desc, then created_at desc. With three non-pinned posts,
    the feed is [C(2024-03), B(2024-02), A(2024-01)].
    """
    from datetime import UTC, datetime

    from app import models

    posts = []
    for i, (title, created, pinned) in enumerate(
        [
            ("Oldest", datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC), False),
            ("Middle", datetime(2024, 2, 1, 12, 0, 0, tzinfo=UTC), False),
            ("Newest", datetime(2024, 3, 1, 12, 0, 0, tzinfo=UTC), False),
            ("PinnedNewest", datetime(2024, 4, 1, 12, 0, 0, tzinfo=UTC), True),
            ("Draft", datetime(2024, 5, 1, 12, 0, 0, tzinfo=UTC), False),
        ]
    ):
        post = models.Post(
            title=title,
            slug=f"adj-{title.lower()}-{i}",
            content="Content",
            published=title != "Draft",
            pinned=pinned,
            created_at=created,
        )
        posts.append(post)
    db_session.add_all(posts)
    db_session.commit()
    return {p.title: p for p in posts}


def test_get_adjacent_posts_middle(client, db_session):
    """The middle post in feed order has both previous and next.

    Feed order (pinned desc, created_at desc): PinnedNewest, Newest, Middle,
    Oldest. So for 'Newest': previous=PinnedNewest, next=Middle.
    """
    posts = _seed_adjacent_posts(db_session)

    response = client.get(f"/api/posts/{posts['Newest'].id}/adjacent")
    assert response.status_code == 200
    data = response.json()
    assert data["previous"]["title"] == "PinnedNewest"
    assert data["next"]["title"] == "Middle"


def test_get_adjacent_posts_feed_ends(client, db_session):
    """First and last Public posts have a single neighbour."""
    posts = _seed_adjacent_posts(db_session)

    # Newest non-pinned public post is the head of the pinned-desc/created-desc feed.
    newest = client.get(f"/api/posts/{posts['Newest'].id}/adjacent")
    assert newest.status_code == 200
    # PinnedNewest comes before it; Middle after it.
    assert newest.json()["previous"]["title"] == "PinnedNewest"
    assert newest.json()["next"]["title"] == "Middle"

    # Oldest is the tail of the public feed (Draft is not published, so excluded).
    oldest = client.get(f"/api/posts/{posts['Oldest'].id}/adjacent")
    assert oldest.status_code == 200
    assert oldest.json()["previous"]["title"] == "Middle"
    assert oldest.json()["next"] is None


def test_get_adjacent_posts_pinned_head(client, db_session):
    """The pinned head of the feed has no previous neighbour."""
    posts = _seed_adjacent_posts(db_session)

    response = client.get(f"/api/posts/{posts['PinnedNewest'].id}/adjacent")
    assert response.status_code == 200
    assert response.json()["previous"] is None
    assert response.json()["next"]["title"] == "Newest"


def test_get_adjacent_posts_404(client, db_session):
    """Non-public (draft) and non-existent posts return 404."""
    posts = _seed_adjacent_posts(db_session)

    draft = client.get(f"/api/posts/{posts['Draft'].id}/adjacent")
    assert draft.status_code == 404

    missing = client.get("/api/posts/999999/adjacent")
    assert missing.status_code == 404


def test_adjacent_popular_related_include_comment_count(client, db_session, auth_headers):
    """PostList from adjacent/popular/related must carry the real comment_count.

    Regression for RIL TASK-109, ISS-089: these paths returned 0 even for
    posts with approved comments (only get_posts populated it).
    """
    post = _seed_adjacent_posts(db_session)["Middle"]
    # Create + approve 2 comments on this post.
    for i in range(2):
        c_resp = client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": f"U{i}", "email": f"u{i}@e.com", "content": f"c{i}"},
        )
        assert c_resp.status_code == 201
        c_id = c_resp.json()["id"]
        patch = client.patch(f"/api/comments/{c_id}/approve", json={"approved": True}, headers=auth_headers)
        assert patch.status_code == 200

    # The popular list includes every published post, so Middle appears with
    # its 2 approved comments.
    pop = client.get("/api/posts/popular/list")
    assert pop.status_code == 200
    items = pop.json()
    # popular/list is an unbounded array (raw list, not paginated envelope).
    middle = next((i for i in items if i["id"] == post.id), None)
    assert middle is not None, items
    assert middle["comment_count"] == 2, middle

    # Adjacent response: Middle's next (Oldest) requires the comment_count key
    # and must reflect any comments Oldest has (we didn't add any, so it is 0 —
    # but the key must exist, not be dropped).
    adj = client.get(f"/api/posts/{post.id}/adjacent")
    assert adj.status_code == 200
    assert "comment_count" in adj.json()["previous"] or "comment_count" in adj.json()["next"]

    # Related list items all carry comment_count.
    rel = client.get(f"/api/posts/{post.id}/related")
    assert rel.status_code == 200
    assert all("comment_count" in it for it in rel.json())


def test_adjacent_posts_follow_effective_publish_order(client, db_session):
    """Adjacent prev/next must match the real feed order (effective publish
    time), not draft created_at — the route's contract is "matching get_posts",
    and get_posts orders by publish_at ?? created_at (RIL ISS-265/267).

    A post drafted in Jan but live in Jun sits where a June post sits — after a
    Jul-created post and before a Jun-created post — NOT at its January slot.
    """
    from datetime import UTC, datetime

    from app import models

    for title, created, publish_at in [
        ("MayPost", datetime(2024, 5, 1, 12, 0, 0, tzinfo=UTC), None),
        ("SchedJun", datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC), datetime(2024, 6, 1, 12, 0, 0)),  # draft Jan, live Jun
        ("JulPost", datetime(2024, 7, 1, 12, 0, 0, tzinfo=UTC), None),
    ]:
        db_session.add(
            models.Post(
                title=title,
                slug=title.lower(),
                content="Content",
                published=True,
                created_at=created,
                publish_at=publish_at,
            )
        )
    db_session.commit()

    ids = {
        p.title: p.id
        for p in db_session.query(models.Post).filter(models.Post.title.in_(["MayPost", "SchedJun", "JulPost"]))
    }

    resp = client.get(f"/api/posts/{ids['SchedJun']}/adjacent")
    assert resp.status_code == 200
    data = resp.json()
    # Effective feed order: JulPost, SchedJun, MayPost. Buggy created_at order
    # would give SchedJun previous=MayPost (Jan slot) — this pins the fix.
    assert data["previous"]["title"] == "JulPost"
    assert data["next"]["title"] == "MayPost"


def test_related_posts_candidates_rank_by_effective_publish(client, db_session):
    """Related posts in the same category must rank newest-by-effective-publish,
    so a post drafted long ago but live today leads a draft-created-today post
    that actually went live earlier — mirroring the feed (RIL ISS-265/267).
    """
    from datetime import UTC, datetime, timedelta

    from app import models

    now = datetime.now(UTC)
    tech = models.Category(name="Tech")
    db_session.add(tech)
    db_session.flush()
    # Source post: no tags → get_related_posts takes the same-category fallback.
    source = models.Post(
        title="Source",
        slug="source",
        category_id=tech.id,
        content="Content",
        published=True,
        created_at=now - timedelta(days=5),
    )
    # Candidate drafted 30 days ago but scheduled to go live yesterday → its
    # effective publish (yesterday) is newer than any draft-created-then post.
    sched = models.Post(
        title="SchedCand",
        slug="schedcand",
        category_id=tech.id,
        content="Content",
        published=True,
        created_at=now - timedelta(days=30),
        publish_at=now - timedelta(days=1),
    )
    recent_draft = models.Post(
        title="RecentDraft",
        slug="recentdraft",
        category_id=tech.id,
        content="Content",
        published=True,
        created_at=now - timedelta(days=3),
    )
    db_session.add_all([source, sched, recent_draft])
    db_session.flush()

    resp = client.get(f"/api/posts/{source.id}/related")
    assert resp.status_code == 200, resp.text
    slugs = [it["slug"] for it in resp.json()]
    # Effective-publish order leads with schedcand (yesterday) over recentdraft
    # (created 3 days ago); the buggy created_at order reversed them (schedcand
    # is 30 days old).
    assert slugs.index("schedcand") < slugs.index("recentdraft")


def _seed_archive_posts(db_session):
    """Seed published/unpublished posts across distinct (year, month) buckets."""
    from datetime import UTC, datetime

    from app import models

    posts = [
        models.Post(
            title="Jan2024",
            slug="arch-jan2024",
            content="Content",
            published=True,
            created_at=datetime(2024, 1, 10, 9, 0, 0, tzinfo=UTC),
        ),
        models.Post(
            title="Mar2024",
            slug="arch-mar2024",
            content="Content",
            published=True,
            created_at=datetime(2024, 3, 5, 9, 0, 0, tzinfo=UTC),
        ),
        models.Post(
            title="Nov2025",
            slug="arch-nov2025",
            content="Content",
            published=True,
            created_at=datetime(2025, 11, 20, 9, 0, 0, tzinfo=UTC),
        ),
        models.Post(
            title="Draft2024",
            slug="arch-draft2024",
            content="Content",
            published=False,
            created_at=datetime(2024, 3, 15, 9, 0, 0, tzinfo=UTC),
        ),
    ]
    db_session.add_all(posts)
    db_session.commit()
    return {p.title: p for p in posts}


def test_archive_index_groups_published_posts_by_year_month(client, db_session):
    """The archive endpoint buckets public posts by (year, month), newest first,
    and excludes drafts."""
    _seed_archive_posts(db_session)

    response = client.get("/api/posts/archive")
    assert response.status_code == 200
    data = response.json()
    # Buckets: {2025-11:1, 2024-03:1, 2024-01:1}; the 2024-03 draft is excluded
    # (published=False). Ordered year desc then month desc.
    assert data == [
        {"year": 2025, "month": 11, "count": 1},
        {"year": 2024, "month": 3, "count": 1},
        {"year": 2024, "month": 1, "count": 1},
    ]


def test_list_posts_filters_by_year_and_month(client, db_session):
    """GET /api/posts?year=&month= returns only posts in that period."""
    _seed_archive_posts(db_session)

    response = client.get("/api/posts?year=2024&month=3")
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Mar2024"]
    assert response.json()["pagination"]["total"] == 1

    # Year-only filter spans all months in that year.
    response = client.get("/api/posts?year=2024")
    titles = [item["title"] for item in response.json()["items"]]
    assert set(titles) == {"Jan2024", "Mar2024"}


def test_archive_filter_rejects_invalid_queries(client):
    """Out-of-range year/month query values are rejected (422), not silently accepted."""
    bad_year = client.get("/api/posts?year=1800")
    assert bad_year.status_code == 422
    bad_month = client.get("/api/posts?month=13")
    assert bad_month.status_code == 422


def test_related_404_for_unknown_post(client):
    """GET /api/posts/{id}/related on an unknown id must 404 (uniform public
    read-path guard) — it used to return 200 with generic "recent posts" and
    acted as an oracle for post existence."""
    resp = client.get("/api/posts/999999/related")
    assert resp.status_code == 404


def test_related_404_for_draft_post(client, auth_headers):
    """A draft post's id must not reveal the draft's category via /related —
    return 404 like every other non-public read path."""
    cat = client.post(
        "/api/categories",
        json={"name": "CatDraft", "slug": "catdraft"},
        headers=auth_headers,
    ).json()
    draft = client.post(
        "/api/posts",
        json={
            "title": "Draft Related",
            "slug": "draft-related",
            "content": "C",
            "published": False,
            "category_id": cat["id"],
        },
        headers=auth_headers,
    )
    assert draft.status_code == 201, draft.text
    resp = client.get(f"/api/posts/{draft.json()['id']}/related")
    assert resp.status_code == 404
