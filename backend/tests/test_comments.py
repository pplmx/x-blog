import pytest


@pytest.fixture(scope="function")
def post(client):
    response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
    )
    return response.json()


def test_create_comment(client, post):
    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["nickname"] == "Test User"
    assert data["email"] == "test@example.com"
    assert data["content"] == "Test comment"
    assert data["post_id"] == post["id"]


def test_list_comments(client, post):
    client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    response = client.get(f"/api/comments/post/{post['id']}")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert len(data["items"]) == 1
    assert data["items"][0]["nickname"] == "Test User"
    assert data["total"] == 1
    assert data["page"] == 1
    assert data["limit"] == 20


def test_list_comments_pagination(client, post):
    # Create 5 comments
    for i in range(5):
        client.post(
            f"/api/comments/post/{post['id']}",
            json={
                "nickname": f"User {i}",
                "email": f"user{i}@example.com",
                "content": f"Comment {i}",
            },
        )

    # Get first page with limit 2
    response = client.get(f"/api/comments/post/{post['id']}?page=1&limit=2")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5
    assert data["page"] == 1
    assert data["limit"] == 2
    assert data["total_pages"] == 3

    # Get second page
    response = client.get(f"/api/comments/post/{post['id']}?page=2&limit=2")
    data = response.json()
    assert len(data["items"]) == 2
    assert data["page"] == 2


def test_delete_comment(client, post):
    create_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    comment_id = create_response.json()["id"]
    response = client.delete(f"/api/comments/{comment_id}")
    assert response.status_code == 204
    list_response = client.get(f"/api/comments/post/{post['id']}")
    assert len(list_response.json()["items"]) == 0
