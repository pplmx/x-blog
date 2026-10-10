from datetime import UTC

from sqlalchemy import select


async def test_create_post(client, auth_headers):
    response = await client.post(
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


async def test_list_posts_returns_cached_second_request(client, auth_headers):
    """The second identical request to /api/posts must serve from the cache.

    We spy on crud.get_posts: the first call queries the DB, the second (cache
    hit) must NOT call it.
    """
    from app import crud

    await client.post(
        "/api/posts",
        json={"title": "Cached Post", "slug": "cached-post", "content": "C", "published": True},
        headers=auth_headers,
    )

    from unittest.mock import patch

    with patch.object(crud, "get_posts", wraps=crud.get_posts) as spy:
        first = await client.get("/api/posts")
        second = await client.get("/api/posts")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert first.json()["pagination"]["total"] == 1
    # First request populates the cache (DB hit); second serves from cache.
    assert spy.call_count == 1


async def test_list_posts_cache_invalidated_on_create(client, auth_headers):
    """Creating a post must invalidate the posts list cache."""
    # Prime the cache with an empty list
    first = await client.get("/api/posts")
    assert first.json()["pagination"]["total"] == 0

    # Creating a published post must drop the stale cache
    await client.post(
        "/api/posts",
        json={
            "title": "New Post",
            "slug": "new-post",
            "content": "C",
            "published": True,
        },
        headers=auth_headers,
    )

    second = await client.get("/api/posts")
    assert second.json()["pagination"]["total"] == 1
    assert second.json()["items"][0]["slug"] == "new-post"


async def test_list_posts_cache_invalidated_on_update(client, auth_headers):
    """Updating a post must drop the stale posts list cache."""
    create = await client.post(
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
    first = await client.get("/api/posts")
    assert first.json()["items"][0]["title"] == "Update Me"

    # Updating the title must invalidate the cache
    response = await client.put(
        f"/api/admin/posts/{post_id}",
        json={"title": "Updated Title"},
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    assert response.status_code == 200

    # Cache miss → fresh fetch reflects the new title
    second = await client.get("/api/posts")
    assert second.json()["items"][0]["title"] == "Updated Title"


async def test_list_posts_cache_invalidated_on_delete(client, auth_headers):
    """Deleting a post must drop the stale posts list cache."""
    create = await client.post(
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
    first = await client.get("/api/posts")
    assert first.json()["pagination"]["total"] == 1

    # Deleting must invalidate the cache
    delete_response = await client.delete(f"/api/admin/posts/{post_id}", headers=auth_headers)
    assert delete_response.status_code in (200, 204)

    # Cache miss → fresh fetch shows the post is gone
    second = await client.get("/api/posts")
    assert second.json()["pagination"]["total"] == 0


async def test_category_post_count_invalidated_on_post_write(client, auth_headers):
    """Assigning a post to a category must refresh the cached category post_count.

    Regresses the stale post_count bug (RIL TASK-074, ISS-042): post writes
    cleared tags/posts caches but not categories_cache, so the per-category
    post_count stayed stale up to the 1800s TTL.
    """
    cat = (
        await client.post(
            "/api/admin/categories",
            json={"name": "Cache Test Cat"},
            headers=auth_headers,
        )
    ).json()

    # Prime the categories cache (post_count 0 for the new category)
    first = await client.get("/api/categories")
    assert next(c for c in first.json() if c["id"] == cat["id"])["post_count"] == 0

    # Create a post in that category -> must drop the cached categories list
    created = await client.post(
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

    second = await client.get("/api/categories")
    assert next(c for c in second.json() if c["id"] == cat["id"])["post_count"] == 1


async def test_list_posts(client, auth_headers):
    await client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
        headers=auth_headers,
    )
    response = await client.get("/api/posts")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["pagination"]["total"] == 1


async def test_get_post(client, auth_headers):
    create_response = await client.post(
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
    response = await client.get(f"/api/posts/{post_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Test Post"


async def test_draft_post_hidden_from_public(client, auth_headers):
    """Drafts must not be readable via the public API by id or slug."""
    create_response = await client.post(
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

    by_id = await client.get(f"/api/posts/{post_id}")
    assert by_id.status_code == 404

    by_slug = await client.get("/api/posts/draft-post")
    assert by_slug.status_code == 404

    # Drafts must not count views or likes either
    view_response = await client.post(f"/api/posts/{post_id}/view")
    assert view_response.status_code == 404
    like_response = await client.post(f"/api/posts/{post_id}/like")
    assert like_response.status_code == 404


async def test_scheduled_post_hidden_until_publish_at(client, auth_headers):
    """Future-dated posts are invisible; past-dated published posts are visible."""
    future_response = await client.post(
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
    future_get = await client.get(f"/api/posts/{future_id}")
    assert future_get.status_code == 404

    past_response = await client.post(
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
    past_get = await client.get(f"/api/posts/{past_id}")
    assert past_get.status_code == 200
    assert past_get.json()["title"] == "Past Post"


async def test_null_views_likes_counter_self_heals_on_increment(client, db_session):
    """A NULL view/like counter (raw-SQL/COPY/legacy row) must not stay NULL.

    Regression for TASK-535/ISS-614: Post.views/likes are nullable with only a
    Python-side default, so a non-ORM insert can land a NULL. An unconditional
    ``Post.views + 1`` then yields NULL on both SQLite and Postgres — the view
    counter stays null forever, POST /view returns ``views: null``, and the
    popular ranking puts the row FIRST on Postgres (NULLS FIRST on DESC) while
    SQLite put it LAST (dialect divergence, DEC-071). COALESCE in the increment
    makes the counter self-heal and the ranking dialect-parity.
    """
    from app import models

    post = models.Post(
        title="Null Counters",
        slug="null-counters",
        content="Content",
        published=True,
        views=None,
        likes=None,
    )
    db_session.add(post)
    await db_session.commit()
    post_id = post.id

    # Increment the view — the NULL must become 1, not stay NULL.
    view_response = await client.post(f"/api/posts/{post_id}/view")
    assert view_response.status_code == 200
    assert view_response.json()["views"] == 1, view_response.json()

    recovered = await db_session.get(models.Post, post_id)
    assert recovered.views == 1
    # The first like also self-heals from NULL to 1.
    like_response = await client.post(f"/api/posts/{post_id}/like")
    assert like_response.status_code == 200
    await db_session.refresh(recovered)
    assert recovered.likes == 1


async def test_null_views_ranks_last_in_popular_and_views_sort(client, db_session):
    """A still-NULL view counter must rank as 0, not first — and not 500.

    Regression continuation of TASK-535: until the first pageview lands, a
    raw/legacy NULL-views row would top `/popular/list` on PostgreSQL
    (default NULLS FIRST for DESC) while SQLite ranked it last. COALESCE in the
    ORDER BY makes both dialects agree. A real NULL must also survive
    serialization (PostList.views is `int = 0`): without the read-side
    BeforeValidator coalesce, the whole feed 500s on such a row.
    """
    from app import models

    db_session.add_all(
        [
            models.Post(title="Null Views", slug="null-views", content="C", published=True, views=0),
            models.Post(title="Ten Views", slug="ten-views", content="C", published=True, views=10),
        ]
    )
    await db_session.commit()
    # Plant a real NULL like a raw-SQL/COPY import would (an ORM `views=None`
    # instead fires the Python-side default and stores 0 — never a NULL, which
    # is why the pre-fix version of this test was vacuous).
    await db_session.execute(
        models.Post.__table__.update().where(models.Post.__table__.c.slug == "null-views").values(views=None)
    )
    await db_session.commit()

    pop = await client.get("/api/posts/popular/list")
    assert pop.status_code == 200, pop.text
    items = pop.json()
    titles = [i["title"] for i in items]
    assert titles.index("Ten Views") < titles.index("Null Views"), titles

    # Same ordering when sorting by views explicitly; the NULL row must also
    # serialize as views=0 instead of failing the whole list's validation.
    listed = await client.get("/api/posts?sort=views")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    arranged = [i["title"] for i in body["items"]]
    assert arranged.index("Ten Views") < arranged.index("Null Views"), arranged
    null_row = next(i for i in body["items"] if i["title"] == "Null Views")
    assert null_row["views"] == 0, null_row


async def test_null_pinned_ranks_with_unpinned_group(client, db_session):
    """A raw/legacy NULL-pinned row must sort with the unpinned group.

    Regression continuation of the TASK-535 NULL-parity discipline, applied to
    Post.pinned (also nullable with only a Python-side default): ORDER BY
    pinned DESC puts NULLs FIRST on PostgreSQL (NULLS FIRST) but LAST on
    SQLite, so a NULL-pinned post would jump to the top of the public feed —
    even above pinned=True rows — on prod while ranking last in dev/test.
    COALESCE(pinned, False) in both the list feed and the adjacent window rank
    makes the dialects agree and prev/next match the feed the reader scans.

    The NULL is planted with a Core UPDATE (`.values(pinned=None)`), the same
    route a raw-SQL/COPY import takes: setting ``pinned=None`` through the ORM
    constructor instead fires the Python-side ``default=False`` (TASK-535's
    NULL trigger), so it would never produce the row this test needs.
    """
    from app import models

    posts = [
        models.Post(title="Pinned", slug="pinned", content="C", published=True, pinned=True, created_at=_dt(2024, 2)),
        models.Post(
            title="Null Pinned", slug="null-pinned", content="C", published=True, pinned=False, created_at=_dt(2024, 3)
        ),
        models.Post(
            title="Unpinned", slug="unpinned", content="C", published=True, pinned=False, created_at=_dt(2024, 1)
        ),
    ]
    db_session.add_all(posts)
    await db_session.commit()
    # Plant a real NULL like a raw import would (bypasses the ORM default).
    await db_session.execute(
        models.Post.__table__.update().where(models.Post.__table__.c.slug == "null-pinned").values(pinned=None)
    )
    await db_session.commit()

    feed = await client.get("/api/posts")
    assert feed.status_code == 200, feed.text
    items = feed.json()["items"]
    titles = [i["title"] for i in items]
    # Pinned sorts first; NULL-pinned must NOT leap above it, and ranks with
    # the unpinned group (newest of the two via created_at desc).
    assert titles.index("Pinned") < titles.index("Null Pinned") < titles.index("Unpinned"), titles
    # And the NULL must serialize as `pinned: false` (read-side coalesce), not
    # fail the whole feed's validation with a 500.
    null_row = next(i for i in items if i["title"] == "Null Pinned")
    assert null_row["pinned"] is False, null_row

    # The adjacent rank must agree with the feed (same window order_by): the
    # NULL-pinned post's previous is the pinned head, not "no previous".
    adj = await client.get(f"/api/posts/{null_row['id']}/adjacent")
    assert adj.status_code == 200, adj.text
    assert adj.json()["previous"]["title"] == "Pinned", adj.json()


def _dt(year: int, month: int):
    """Naive-UTC datetime helper so feed order is deterministic within a test."""
    from datetime import datetime

    return datetime(year, month, 1, 12, 0, 0, tzinfo=UTC).replace(tzinfo=None)


async def test_update_post(client, auth_headers):
    create_response = await client.post(
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
    response = await client.put(
        f"/api/posts/{post_id}",
        json={"title": "Updated Title"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Updated Title"


async def test_update_post_rejects_orphan_author_and_unknown_tag(client, auth_headers):
    """PUT /api/posts/{id} (crud.update_post) must 400 on an unknown author_id
    or tag_id instead of silently orphaning (TASK-479, ISS-555/ISS-556).

    category_id/series_id already 400 here; author_id was assigned blind (a
    deleted writer left the post author: null with a 404 writer archive/RSS and
    a missed author fan-out) and unknown tag_ids vanished from the save."""
    create_response = await client.post(
        "/api/posts",
        json={
            "title": "Validation Contract",
            "slug": "validation-contract",
            "content": "Content",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create_response.json()["id"]

    bad_author = await client.put(
        f"/api/posts/{post_id}",
        json={"author_id": 99999},
        headers=auth_headers,
    )
    assert bad_author.status_code == 400
    assert "99999" in bad_author.json()["error"]["message"]

    bad_tag = await client.put(
        f"/api/posts/{post_id}",
        json={"tag_ids": [99999]},
        headers=auth_headers,
    )
    assert bad_tag.status_code == 400
    assert "99999" in bad_tag.json()["error"]["message"]


async def test_delete_post(client, auth_headers):
    create_response = await client.post(
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
    response = await client.delete(f"/api/posts/{post_id}", headers=auth_headers)
    assert response.status_code == 204
    get_response = await client.get(f"/api/posts/{post_id}")
    assert get_response.status_code == 404


async def test_get_post_unicode_digit_not_treated_as_id(client):
    """Unicode superscript digits should be treated as slugs, not post IDs.

    str.isdigit() returns True for Unicode digits like '²', but int('²')
    raises ValueError. The endpoint should not crash on such input.
    """
    response = await client.get("/api/posts/%C2%B2")  # '²' URL-encoded
    # Should not be 500 (internal server error); either 404 or treated as slug
    assert response.status_code != 500
    assert response.status_code in (200, 404)


async def test_get_post_huge_numeric_id_does_not_crash(client):
    """A very long all-digit path segment must not 500.

    Python 3.14 raises ValueError ('Exceeds the limit (4300 digits)') for
    int() of >4300-digit strings, and even ~30 digits exceeds the 64-bit
    BIGINT range the id columns use. With the ≤15-digit numeric-id bound the
    oversized segment is treated as a slug lookup → 404, never a 500.
    """
    huge = "9" * 5000
    response = await client.get(f"/api/posts/{huge}")
    assert response.status_code == 404

    over_bigint = "9" * 30  # 30 digits: beyond 64-bit, still 'all digits'
    response = await client.get(f"/api/posts/{over_bigint}")
    assert response.status_code in (200, 404)  # definitely not 500
    assert response.status_code != 500


async def test_huge_int_params_are_422_not_500(client, auth_headers):
    """Out-of-range id/page params must be rejected with 422, never a 500.

    An unbounded ``post_id: int`` path param accepted input like
    99999999999999999999 (a valid Python int — arbitrary precision — only
    overflowing at the DBAPI bind on SQLite) and 500'd the public route
    (round 276 deep-dive). Bound both path ids and query page to the real
    id range so garbage input gets the repo-standard 422 instead.
    """
    huge = "9" * 25  # valid big int, way past any real autoincrement id
    for endpoint in (
        f"/api/posts/{huge}/like",
        f"/api/posts/{huge}/view",
        f"/api/posts/{huge}/adjacent",
        f"/api/posts/{huge}/related",
    ):
        r = (
            await client.get(endpoint)
            if "adjacent" in endpoint or "related" in endpoint
            else await client.post(endpoint)
        )
        assert r.status_code == 422, f"{endpoint} -> {r.status_code}"

    # page beyond the pagination bound (avoids OFFSET overflow).
    r = await client.get("/api/posts?page=999999999999")
    assert r.status_code == 422

    # A normal id still works (no regression for real requests).
    create_response = await client.post(
        "/api/posts",
        json={
            "title": "Huge-int Guard Post",
            "slug": "huge-int-guard-post",
            "content": "body",
            "published": True,
        },
        headers=auth_headers,
    )
    post_id = create_response.json()["id"]
    r = await client.post(f"/api/posts/{post_id}/like")
    assert r.status_code in (200, 201)


async def test_create_post_with_cover_image(client, auth_headers):
    """Creating a post with cover_image should save it."""
    response = await client.post(
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


async def test_update_post_with_cover_image(client, auth_headers):
    """Updating a post with cover_image should persist it."""
    create_response = await client.post(
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

    update_response = await client.put(
        f"/api/posts/{post_id}",
        json={"cover_image": "https://example.com/new-cover.jpg"},
        headers=auth_headers,
    )
    assert update_response.status_code == 200
    assert update_response.json()["cover_image"] == "https://example.com/new-cover.jpg"


async def test_delete_post_with_conflicting_data_returns_error_not_500(client, auth_headers, db_session):
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
    await db_session.commit()

    response = await client.put(
        f"/api/posts/{post2.id}",
        json={"slug": "post-a-slug"},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "already exists" in response.json()["error"]["message"]


async def _seed_adjacent_posts(db_session):
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
    await db_session.commit()
    return {p.title: p for p in posts}


async def test_get_adjacent_posts_middle(client, db_session):
    """The middle post in feed order has both previous and next.

    Feed order (pinned desc, created_at desc): PinnedNewest, Newest, Middle,
    Oldest. So for 'Newest': previous=PinnedNewest, next=Middle.
    """
    posts = await _seed_adjacent_posts(db_session)

    response = await client.get(f"/api/posts/{posts['Newest'].id}/adjacent")
    assert response.status_code == 200
    data = response.json()
    assert data["previous"]["title"] == "PinnedNewest"
    assert data["next"]["title"] == "Middle"


async def test_get_adjacent_posts_feed_ends(client, db_session):
    """First and last Public posts have a single neighbour."""
    posts = await _seed_adjacent_posts(db_session)

    # Newest non-pinned public post is the head of the pinned-desc/created-desc feed.
    newest = await client.get(f"/api/posts/{posts['Newest'].id}/adjacent")
    assert newest.status_code == 200
    # PinnedNewest comes before it; Middle after it.
    assert newest.json()["previous"]["title"] == "PinnedNewest"
    assert newest.json()["next"]["title"] == "Middle"

    # Oldest is the tail of the public feed (Draft is not published, so excluded).
    oldest = await client.get(f"/api/posts/{posts['Oldest'].id}/adjacent")
    assert oldest.status_code == 200
    assert oldest.json()["previous"]["title"] == "Middle"
    assert oldest.json()["next"] is None


async def test_get_adjacent_posts_pinned_head(client, db_session):
    """The pinned head of the feed has no previous neighbour."""
    posts = await _seed_adjacent_posts(db_session)

    response = await client.get(f"/api/posts/{posts['PinnedNewest'].id}/adjacent")
    assert response.status_code == 200
    assert response.json()["previous"] is None
    assert response.json()["next"]["title"] == "Newest"


async def test_get_adjacent_posts_404(client, db_session):
    """Non-public (draft) and non-existent posts return 404."""
    posts = await _seed_adjacent_posts(db_session)

    draft = await client.get(f"/api/posts/{posts['Draft'].id}/adjacent")
    assert draft.status_code == 404

    missing = await client.get("/api/posts/999999/adjacent")
    assert missing.status_code == 404


async def test_adjacent_popular_related_include_comment_count(client, db_session, auth_headers):
    """PostList from adjacent/popular/related must carry the real comment_count.

    Regression for RIL TASK-109, ISS-089: these paths returned 0 even for
    posts with approved comments (only get_posts populated it).
    """
    post = (await _seed_adjacent_posts(db_session))["Middle"]
    # Create + approve 2 comments on this post.
    for i in range(2):
        c_resp = await client.post(
            f"/api/comments/post/{post.id}",
            json={"nickname": f"U{i}", "email": f"u{i}@e.com", "content": f"c{i}"},
        )
        assert c_resp.status_code == 201
        c_id = c_resp.json()["id"]
        patch = await client.patch(f"/api/comments/{c_id}/approve", json={"approved": True}, headers=auth_headers)
        assert patch.status_code == 200

    # The popular list includes every published post, so Middle appears with
    # its 2 approved comments.
    pop = await client.get("/api/posts/popular/list")
    assert pop.status_code == 200
    items = pop.json()
    # popular/list is an unbounded array (raw list, not paginated envelope).
    middle = next((i for i in items if i["id"] == post.id), None)
    assert middle is not None, items
    assert middle["comment_count"] == 2, middle

    # Adjacent response: Middle's next (Oldest) requires the comment_count key
    # and must reflect any comments Oldest has (we didn't add any, so it is 0 —
    # but the key must exist, not be dropped).
    adj = await client.get(f"/api/posts/{post.id}/adjacent")
    assert adj.status_code == 200
    assert "comment_count" in adj.json()["previous"] or "comment_count" in adj.json()["next"]

    # Related list items all carry comment_count.
    rel = await client.get(f"/api/posts/{post.id}/related")
    assert rel.status_code == 200
    assert all("comment_count" in it for it in rel.json())


async def test_adjacent_posts_follow_effective_publish_order(client, db_session):
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
    await db_session.commit()

    rows = (
        (await db_session.execute(select(models.Post).where(models.Post.title.in_(["MayPost", "SchedJun", "JulPost"]))))
        .scalars()
        .all()
    )
    ids = {p.title: p.id for p in rows}

    resp = await client.get(f"/api/posts/{ids['SchedJun']}/adjacent")
    assert resp.status_code == 200
    data = resp.json()
    # Effective feed order: JulPost, SchedJun, MayPost. Buggy created_at order
    # would give SchedJun previous=MayPost (Jan slot) — this pins the fix.
    assert data["previous"]["title"] == "JulPost"
    assert data["next"]["title"] == "MayPost"


async def test_related_posts_candidates_rank_by_effective_publish(client, db_session):
    """Related posts in the same category must rank newest-by-effective-publish,
    so a post drafted long ago but live today leads a draft-created-today post
    that actually went live earlier — mirroring the feed (RIL ISS-265/267).
    """
    from datetime import UTC, datetime, timedelta

    from app import models

    now = datetime.now(UTC)
    tech = models.Category(name="Tech")
    db_session.add(tech)
    await db_session.flush()
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
    await db_session.flush()

    resp = await client.get(f"/api/posts/{source.id}/related")
    assert resp.status_code == 200, resp.text
    slugs = [it["slug"] for it in resp.json()]
    # Effective-publish order leads with schedcand (yesterday) over recentdraft
    # (created 3 days ago); the buggy created_at order reversed them (schedcand
    # is 30 days old).
    assert slugs.index("schedcand") < slugs.index("recentdraft")


async def _seed_archive_posts(db_session):
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
    await db_session.commit()
    return {p.title: p for p in posts}


async def test_archive_index_groups_published_posts_by_year_month(client, db_session):
    """The archive endpoint buckets public posts by (year, month), newest first,
    and excludes drafts."""
    await _seed_archive_posts(db_session)

    response = await client.get("/api/posts/archive")
    assert response.status_code == 200
    data = response.json()
    # Buckets: {2025-11:1, 2024-03:1, 2024-01:1}; the 2024-03 draft is excluded
    # (published=False). Ordered year desc then month desc.
    assert data == [
        {"year": 2025, "month": 11, "count": 1},
        {"year": 2024, "month": 3, "count": 1},
        {"year": 2024, "month": 1, "count": 1},
    ]


async def test_list_posts_filters_by_year_and_month(client, db_session):
    """GET /api/posts?year=&month= returns only posts in that period."""
    await _seed_archive_posts(db_session)

    response = await client.get("/api/posts?year=2024&month=3")
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Mar2024"]
    assert response.json()["pagination"]["total"] == 1

    # Year-only filter spans all months in that year.
    response = await client.get("/api/posts?year=2024")
    titles = [item["title"] for item in response.json()["items"]]
    assert set(titles) == {"Jan2024", "Mar2024"}


async def test_archive_filter_rejects_invalid_queries(client):
    """Out-of-range year/month query values are rejected (422), not silently accepted."""
    bad_year = await client.get("/api/posts?year=1800")
    assert bad_year.status_code == 422
    bad_month = await client.get("/api/posts?month=13")
    assert bad_month.status_code == 422


async def test_related_404_for_unknown_post(client):
    """GET /api/posts/{id}/related on an unknown id must 404 (uniform public
    read-path guard) — it used to return 200 with generic "recent posts" and
    acted as an oracle for post existence."""
    resp = await client.get("/api/posts/999999/related")
    assert resp.status_code == 404


async def test_related_404_for_draft_post(client, auth_headers):
    """A draft post's id must not reveal the draft's category via /related —
    return 404 like every other non-public read path."""
    cat = (
        await client.post(
            "/api/categories",
            json={"name": "CatDraft", "slug": "catdraft"},
            headers=auth_headers,
        )
    ).json()
    draft = await client.post(
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
    resp = await client.get(f"/api/posts/{draft.json()['id']}/related")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Round 387 (DEC-438): public "Trending this week" — /posts/trending/list
# ---------------------------------------------------------------------------


async def test_trending_ranks_published_posts_by_in_window_views(client, db_session, auth_headers):
    """Trending orders published posts by the sum of in-window daily views and
    attaches views_window; posts with rows only outside the window are absent."""
    from datetime import timedelta

    from app import crud, models

    ids = {}
    for name, slug in [("Trend A", "trend-a"), ("Trend B", "trend-b"), ("Trend C", "trend-c")]:
        r = await client.post(
            "/api/posts",
            json={"title": name, "slug": slug, "content": "C", "published": True},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        ids[name] = r.json()["id"]

    today = crud.utc_now_naive().date()
    # A: 3 views today; B: 2 views three days ago (both inside the 7d window);
    # C: 5 views 40 days ago (outside — must not rank despite more cumulative).
    db_session.add_all(
        [
            models.PostViewsDaily(post_id=ids["Trend A"], day=today, views=3),
            models.PostViewsDaily(post_id=ids["Trend B"], day=today - timedelta(days=3), views=2),
            models.PostViewsDaily(post_id=ids["Trend C"], day=today - timedelta(days=40), views=5),
        ]
    )
    await db_session.commit()

    resp = await client.get("/api/posts/trending/list")
    assert resp.status_code == 200
    items = resp.json()
    item_ids = [i["id"] for i in items]
    assert item_ids[0] == ids["Trend A"], items  # 3 in-window views beat 2
    assert ids["Trend B"] in item_ids
    assert ids["Trend C"] not in item_ids  # outside the window regardless of total
    a = next(i for i in items if i["id"] == ids["Trend A"])
    assert a["views_window"] == 3
    # PostList fields still serialize (deep-linkable, comment_count populated).
    assert a["slug"] == "trend-a"
    assert "comment_count" in a


async def test_trending_days_param_widens_the_window(client, db_session, auth_headers):
    """days=30 includes rows at 21 days out that the default 7d window drops."""
    from datetime import timedelta

    from app import crud, models

    post = await client.post(
        "/api/posts",
        json={"title": "Windows", "slug": "trend-windows", "content": "C", "published": True},
        headers=auth_headers,
    )
    assert post.status_code == 201, post.text

    today = crud.utc_now_naive().date()
    db_session.add(models.PostViewsDaily(post_id=post.json()["id"], day=today - timedelta(days=21), views=4))
    await db_session.commit()

    default = (await client.get("/api/posts/trending/list")).json()
    assert all(i["id"] != post.json()["id"] for i in default)

    widened = (await client.get("/api/posts/trending/list?days=30")).json()
    hit = next((i for i in widened if i["id"] == post.json()["id"]), None)
    assert hit is not None, widened
    assert hit["views_window"] == 4


async def test_trending_excludes_drafts_and_future_scheduled_posts(client, db_session, auth_headers):
    """Only effective-live posts rank: drafts and future-scheduled posts with
    in-window daily rows are filtered out — while a live control post ranks, so
    the negatives are asserted against a non-empty result."""
    from datetime import timedelta

    from app import crud, models

    control = (
        await client.post(
            "/api/posts",
            json={"title": "Trend Control", "slug": "trend-control", "content": "C", "published": True},
            headers=auth_headers,
        )
    ).json()
    draft = (
        await client.post(
            "/api/posts",
            json={"title": "Trend Draft", "slug": "trend-draft", "content": "C", "published": False},
            headers=auth_headers,
        )
    ).json()
    scheduled = (
        await client.post(
            "/api/posts",
            json={
                "title": "Trend Scheduled",
                "slug": "trend-scheduled",
                "content": "C",
                "published": True,
                "publish_at": (crud.utc_now_naive() + timedelta(days=2)).isoformat(),
            },
            headers=auth_headers,
        )
    ).json()

    today = crud.utc_now_naive().date()
    db_session.add_all(
        [
            models.PostViewsDaily(post_id=control["id"], day=today, views=7),
            models.PostViewsDaily(post_id=draft["id"], day=today, views=9),
            models.PostViewsDaily(post_id=scheduled["id"], day=today, views=9),
        ]
    )
    await db_session.commit()

    items = (await client.get("/api/posts/trending/list")).json()
    # The live control ranks (non-vacuous: the draft/scheduled rows would
    # otherwise be the only rows, making the negatives pass on an empty list).
    assert any(i["id"] == control["id"] for i in items), items
    assert items[0]["views_window"] == 7, items
    assert all(i["id"] != draft["id"] for i in items)
    assert all(i["id"] != scheduled["id"] for i in items)


async def test_trending_empty_window_returns_empty_list(client):
    """A fresh install (no post_views_daily rows) returns [] — the home
    section hides instead of erroring."""
    resp = await client.get("/api/posts/trending/list")
    assert resp.status_code == 200
    assert resp.json() == []
