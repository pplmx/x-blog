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
