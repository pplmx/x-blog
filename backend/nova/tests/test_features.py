from app import models


def test_pinned_post_creation(client, auth_headers):
    """Test creating a pinned post."""
    response = client.post(
        "/api/posts",
        json={
            "title": "Pinned Post",
            "slug": "pinned-post",
            "content": "This is a pinned post",
            "published": True,
            "pinned": True,
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["pinned"] is True


def test_pinned_posts_appear_first(client, db_session):
    """Test that pinned posts appear first in list."""
    # Create regular post
    regular = models.Post(
        title="Regular Post",
        slug="regular-post",
        content="Content",
        published=True,
        pinned=False,
    )
    db_session.add(regular)

    # Create pinned post
    pinned = models.Post(
        title="Pinned Post",
        slug="pinned-post",
        content="Pinned Content",
        published=True,
        pinned=True,
    )
    db_session.add(pinned)
    db_session.commit()

    response = client.get("/api/posts")
    assert response.status_code == 200
    data = response.json()

    # Pinned post should be first
    assert data["items"][0]["pinned"] is True


def test_like_post(client, db_session):
    """Test liking a post."""
    post = models.Post(
        title="Test Post",
        slug="test-post-like",
        content="Content",
        published=True,
        likes=5,
    )
    db_session.add(post)
    db_session.commit()

    response = client.post("/api/posts/1/like")
    assert response.status_code == 200
    data = response.json()
    assert data["likes"] == 6


def test_like_nonexistent_post(client):
    """Test liking a non-existent post returns 404."""
    response = client.post("/api/posts/99999/like")
    assert response.status_code == 404


def test_related_posts_endpoint(client, db_session):
    """Test getting related posts."""
    # Create category
    category = models.Category(name="Tech")
    db_session.add(category)
    db_session.commit()

    # Create posts with same category
    post1 = models.Post(
        title="Post 1",
        slug="post-1",
        content="Content 1",
        published=True,
        category_id=category.id,
    )
    post2 = models.Post(
        title="Post 2",
        slug="post-2",
        content="Content 2",
        published=True,
        category_id=category.id,
    )
    db_session.add(post1)
    db_session.add(post2)
    db_session.commit()

    response = client.get(f"/api/posts/{post1.id}/related")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1


def test_export_posts_csv(client, auth_headers, db_session):
    """Test exporting posts to CSV."""
    post = models.Post(
        title="Export Test",
        slug="export-test",
        content="Test content",
        published=True,
        views=100,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/export/posts.csv", headers=auth_headers)
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    content = response.text
    assert "Export Test" in content
    assert "Title" in content  # CSV header


def test_export_comments_csv(client, auth_headers, db_session):
    """Test exporting comments to CSV."""
    post = models.Post(
        title="Test Post",
        slug="test-post-export",
        content="Content",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    comment = models.Comment(
        post_id=post.id,
        nickname="Test User",
        email="test@example.com",
        content="Great post!",
    )
    db_session.add(comment)
    db_session.commit()

    response = client.get("/api/export/comments.csv", headers=auth_headers)
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]


def test_posts_list_reading_time(client, db_session):
    """Test that /api/posts surfaces reading_time derived from content length."""
    # 1200 space-separated words -> 1200/200 = 6 min (frontend formula)
    post = models.Post(
        title="Long Post",
        slug="long-post",
        content="word " * 1200,
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/posts")
    assert response.status_code == 200
    data = response.json()
    item = next(i for i in data["items"] if i["slug"] == "long-post")
    assert item["reading_time"] == 6


def test_related_posts_reading_time(client, db_session):
    """Test that related/popular PostList responses include reading_time."""
    category = models.Category(name="Tech")
    db_session.add(category)
    db_session.commit()

    post1 = models.Post(
        title="Post 1",
        slug="post-rt-1",
        content="word " * 400,  # 400/200 = 2 min
        published=True,
        category_id=category.id,
        views=100,
    )
    post2 = models.Post(
        title="Post 2",
        slug="post-rt-2",
        content="word " * 800,  # 800/200 = 4 min
        published=True,
        category_id=category.id,
        views=50,
    )
    db_session.add(post1)
    db_session.add(post2)
    db_session.commit()

    related = client.get(f"/api/posts/{post1.id}/related")
    assert related.status_code == 200
    assert all("reading_time" in p for p in related.json())

    popular = client.get("/api/posts/popular/list")
    assert popular.status_code == 200
    assert all("reading_time" in p for p in popular.json())
