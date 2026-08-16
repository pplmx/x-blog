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


def test_posts_list_includes_comment_count(client, post, auth_headers):
    """PostList should expose comment_count, counting approved comments only.

    Comment create/approve must auto-invalidate the cached posts list (RIL
    TASK-073, ISS-041); no manual cache clears here.
    """
    # No comments yet -> 0
    assert client.get("/api/posts").json()["items"][0]["comment_count"] == 0

    # Add an unapproved comment -> still 0 (not counted)
    unapproved = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Spammer",
            "email": "spam@example.com",
            "content": "Buy now!",
        },
    ).json()
    assert client.get("/api/posts").json()["items"][0]["comment_count"] == 0

    # Approve it -> count becomes 1 (posts list cache invalidated on approve)
    client.patch(
        f"/api/comments/{unapproved['id']}/approve",
        json={"approved": True},
        headers=auth_headers,
    )
    assert client.get("/api/posts").json()["items"][0]["comment_count"] == 1


def test_create_comment_requires_moderation(client, post, auth_headers):
    """Comments can never self-approve: is_approved is server-controlled."""
    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Spammer",
            "email": "spam@example.com",
            "content": "Buy now!",
            "is_approved": True,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["is_approved"] is False

    # Not visible publicly until an admin approves it
    list_response = client.get(f"/api/comments/post/{post['id']}")
    assert len(list_response.json()["items"]) == 0

    approve_response = client.patch(
        f"/api/comments/{data['id']}/approve",
        json={"approved": True},
        headers=auth_headers,
    )
    assert approve_response.status_code == 200


@pytest.fixture(scope="function")
def draft_post(client, auth_headers):
    response = client.post(
        "/api/posts",
        json={
            "title": "Draft Post",
            "slug": "draft-post",
            "content": "Not yet public",
            "published": False,
        },
        headers=auth_headers,
    )
    return response.json()


def test_create_comment_on_draft_post_returns_404(client, draft_post):
    """Draft posts are invisible publicly, so commenting on them must 404.

    Without this guard the comment endpoint leaked that a hidden post exists
    (201 for drafts vs 400 "Post not found" for unknown ids) and let visitors
    queue comments on drafts that surface once the post goes public.
    """
    assert client.get(f"/api/posts/{draft_post['id']}").status_code == 404
    response = client.post(
        f"/api/comments/post/{draft_post['id']}",
        json={
            "nickname": "Probe",
            "email": "probe@example.com",
            "content": "Should not be accepted",
        },
    )
    assert response.status_code == 404
    data = response.json()
    assert data["error"]["code"] == "NOT_FOUND"
    # The draft must also not be discoverable via the comment list
    assert len(client.get(f"/api/comments/post/{draft_post['id']}").json()["items"]) == 0


def test_create_comment_on_scheduled_future_post_returns_404(client, auth_headers):
    """A scheduled post is not public before publish_at, so comments must 404."""
    future = "2099-01-01T00:00:00"
    response = client.post(
        "/api/posts",
        json={
            "title": "Scheduled Post",
            "slug": "scheduled-post",
            "content": "Coming soon",
            "published": True,
            "publish_at": future,
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    post_id = response.json()["id"]

    assert client.get(f"/api/posts/{post_id}").status_code == 404
    comment = client.post(
        f"/api/comments/post/{post_id}",
        json={
            "nickname": "Probe",
            "email": "probe@example.com",
            "content": "Should not be accepted",
        },
    )
    assert comment.status_code == 404
    assert comment.json()["error"]["code"] == "NOT_FOUND"


def test_list_comments(client, post, auth_headers):
    create_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    # Comments require moderation before appearing publicly
    client.patch(
        f"/api/comments/{create_response.json()['id']}/approve",
        json={"approved": True},
        headers=auth_headers,
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


def test_list_comments_pagination(client, post, auth_headers):
    # Create 5 comments
    comment_ids = []
    for i in range(5):
        create_response = client.post(
            f"/api/comments/post/{post['id']}",
            json={
                "nickname": f"User {i}",
                "email": f"user{i}@example.com",
                "content": f"Comment {i}",
            },
        )
        comment_ids.append(create_response.json()["id"])

    # Approve all comments so they appear publicly
    for comment_id in comment_ids:
        client.patch(
            f"/api/comments/{comment_id}/approve",
            json={"approved": True},
            headers=auth_headers,
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
    """Creating a comment on a non-existent post should return 404.

    404 (not 400) matches the visibility guard: hidden drafts, scheduled
    posts and nonexistent ids all answer the same way, so the endpoint no
    longer leaks whether a hidden post exists.
    """
    response = client.post(
        "/api/comments/post/99999",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    assert response.status_code == 404
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


def test_create_comment_rejects_reply_to_unapproved_parent(client, post):
    """A reply to a pending (awaiting-approval) parent comment must return 400.

    API-created comments are never auto-approved, so a pending parent is not
    publicly visible; allowing a reply could orphan an approved reply under a
    parent a moderator later rejects.
    """
    parent_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Pending Parent",
            "email": "parent@example.com",
            "content": "Awaiting approval",
        },
    )
    assert parent_response.status_code == 201
    pending_parent_id = parent_response.json()["id"]

    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Child",
            "email": "child@example.com",
            "content": "Reply to pending parent",
            "parent_id": pending_parent_id,
        },
    )
    assert response.status_code == 400
    assert "Cannot reply to a comment awaiting approval" in response.json()["error"]["message"]


def test_list_comments_rejects_invalid_pagination(client, post):
    """Negative/zero/oversized limits must be rejected, not 500."""
    response = client.get(f"/api/comments/post/{post['id']}?limit=-1")
    assert response.status_code == 422

    response = client.get(f"/api/comments/post/{post['id']}?limit=0")
    assert response.status_code == 422

    response = client.get(f"/api/comments/post/{post['id']}?limit=1000")
    assert response.status_code == 422

    response = client.get(f"/api/comments/post/{post['id']}?page=0")
    assert response.status_code == 422


def test_create_comment_rejects_overlong_nickname(client, post):
    """Over-length nickname must be rejected as 422, never stored or 500.

    Regresses the schema/column mismatch: on PostgreSQL an over-length
    nickname used to surface as an uncaught DataError -> 500; the max_length
    boundary now rejects it consistently on every backend.
    """
    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "n" * 51,
            "email": "test@example.com",
            "content": "Too long a nickname",
        },
    )
    assert response.status_code == 422

    list_response = client.get(f"/api/comments/post/{post['id']}")
    assert len(list_response.json()["items"]) == 0


def test_create_comment_rejects_overlong_content(client, post):
    """Over-length comment content is rejected as 422 (bounded CommentBase.content).

    The public comment endpoint is unauthenticated, so an unbounded content field
    would let anyone bloat the DB/response with multi-MB bodies.
    """
    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "tester",
            "email": "test@example.com",
            "content": "x" * 5001,
        },
    )
    assert response.status_code == 422


def test_create_comment_accepts_boundary_length_content(client, post):
    """Exactly max_length (5000) content is accepted."""
    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "tester",
            "email": "test@example.com",
            "content": "x" * 5000,
        },
    )
    assert response.status_code == 201
