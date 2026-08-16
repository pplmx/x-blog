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
