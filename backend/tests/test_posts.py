import pytest


def test_create_post(client):
    response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Post"
    assert data["slug"] == "test-post"


def test_list_posts(client):
    client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
    )
    response = client.get("/api/posts")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["pagination"]["total"] == 1


def test_get_post(client):
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
    )
    post_id = create_response.json()["id"]
    response = client.get(f"/api/posts/{post_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Test Post"


def test_update_post(client):
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
    )
    post_id = create_response.json()["id"]
    response = client.put(f"/api/posts/{post_id}", json={"title": "Updated Title"})
    assert response.status_code == 200
    assert response.json()["title"] == "Updated Title"


def test_delete_post(client):
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
    )
    post_id = create_response.json()["id"]
    response = client.delete(f"/api/posts/{post_id}")
    assert response.status_code == 204
    get_response = client.get(f"/api/posts/{post_id}")
    assert get_response.status_code == 404
