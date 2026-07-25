import pytest


@pytest.fixture(scope="function")
def post(client, auth_headers):
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


def test_delete_comment(client, post, auth_headers):
    create_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    comment_id = create_response.json()["id"]
    response = client.delete(
        f"/api/comments/{comment_id}",
        headers=auth_headers,
    )
    assert response.status_code == 204
    list_response = client.get(f"/api/comments/post/{post['id']}")
    assert len(list_response.json()["items"]) == 0


def test_delete_comment_not_found(client, auth_headers):
    response = client.delete(
        "/api/comments/99999",
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_delete_comment_requires_auth(client, post):
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
    assert response.status_code == 401


def test_approve_comment(client, post, auth_headers):
    create_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    comment_id = create_response.json()["id"]
    response = client.patch(
        f"/api/comments/{comment_id}/approve",
        json={"approved": True},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["is_approved"] is True


def test_approve_comment_not_found(client, auth_headers):
    response = client.patch(
        "/api/comments/99999/approve",
        json={"approved": True},
        headers=auth_headers,
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_approve_comment_unauthorized(client, post):
    create_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    comment_id = create_response.json()["id"]
    response = client.patch(
        f"/api/comments/{comment_id}/approve",
        json={"approved": True},
    )
    assert response.status_code == 401


def test_create_comment_on_nonexistent_post(client):
    """Creating a comment on a non-existent post should return 400."""
    response = client.post(
        "/api/comments/post/99999",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    assert response.status_code == 400
    assert "not found" in response.json()["error"]["message"]


def test_create_comment_with_parent_from_different_post(client, post, auth_headers):
    """Replying to a parent comment from a different post should return 400."""
    # Create a second post
    other_post = client.post(
        "/api/posts",
        json={
            "title": "Another Post",
            "slug": "another-post",
            "content": "More content",
            "published": True,
        },
        headers=auth_headers,
    )
    assert other_post.status_code in (200, 201), f"Failed to create second post: {other_post.json()}"

    # Create a comment on the original post
    parent_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Parent",
            "email": "parent@example.com",
            "content": "Parent comment",
        },
    )
    parent_id = parent_response.json()["id"]

    # Try to create a reply on the other post referencing the parent
    response = client.post(
        f"/api/comments/post/{other_post.json()['id']}",
        json={
            "nickname": "Child",
            "email": "child@example.com",
            "content": "Reply to parent",
            "parent_id": parent_id,
        },
    )
    assert response.status_code == 400
    assert "Parent comment does not belong to this post" in response.json()["error"]["message"]


def test_create_comment_with_nonexistent_parent(client, post):
    """Replying to a non-existent parent comment should return 400."""
    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Child",
            "email": "child@example.com",
            "content": "Reply",
            "parent_id": 99999,
        },
    )
    assert response.status_code == 400
    assert "Parent comment with id 99999 not found" in response.json()["error"]["message"]
