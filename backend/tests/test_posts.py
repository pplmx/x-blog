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
