import pytest
from app import models


def test_pinned_post_creation(client):
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


def test_export_posts_csv(client, db_session):
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

    response = client.get("/api/export/posts.csv")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    content = response.text
    assert "Export Test" in content
    assert "Title" in content  # CSV header


def test_export_comments_csv(client, db_session):
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

    response = client.get("/api/export/comments.csv")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]