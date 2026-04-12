from app import models


# ============== Pinned Posts Tests ==============
def test_update_post_pinned_status(client, db_session):
    """Test updating pinned status of a post."""
    post = models.Post(
        title="Test Post",
        slug="test-pinned-update",
        content="Content",
        published=True,
        pinned=False,
    )
    db_session.add(post)
    db_session.commit()

    response = client.put(
        f"/api/posts/{post.id}",
        json={"pinned": True},
    )
    assert response.status_code == 200
    assert response.json()["pinned"] is True


def test_pinned_posts_sorted_first_in_category(client, db_session):
    """Test pinned posts appear first within their category."""
    category = models.Category(name="Tech")
    db_session.add(category)
    db_session.commit()

    regular = models.Post(
        title="Regular",
        slug="regular-sorted",
        content="Content",
        published=True,
        pinned=False,
        category_id=category.id,
    )
    pinned = models.Post(
        title="Pinned",
        slug="pinned-sorted",
        content="Pinned Content",
        published=True,
        pinned=True,
        category_id=category.id,
    )
    db_session.add(regular)
    db_session.add(pinned)
    db_session.commit()

    response = client.get(f"/api/posts?category_id={category.id}")
    data = response.json()
    assert data["items"][0]["pinned"] is True


# ============== Likes Tests ==============
def test_like_count_persists(client, db_session):
    """Test like count persists after multiple likes."""
    post = models.Post(
        title="Like Test",
        slug="like-count-test",
        content="Content",
        published=True,
        likes=0,
    )
    db_session.add(post)
    db_session.commit()

    # First like
    client.post(f"/api/posts/{post.id}/like")
    # Second like
    response = client.post(f"/api/posts/{post.id}/like")

    assert response.json()["likes"] >= 1


def test_views_and_likes_in_post_list(client, db_session):
    """Test views and likes are included in post list response."""
    post = models.Post(
        title="Stats Test",
        slug="stats-test",
        content="Content",
        published=True,
        views=100,
        likes=50,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/posts")
    data = response.json()
    assert "views" in data["items"][0]
    assert "likes" in data["items"][0]


# ============== Related Posts Tests ==============
def test_related_posts_by_tag(client, db_session):
    """Test related posts by matching tags."""
    tag = models.Tag(name="Python")
    db_session.add(tag)
    db_session.commit()

    post1 = models.Post(
        title="Post with Tag",
        slug="post-with-tag",
        content="Content",
        published=True,
    )
    post1.tags.append(tag)

    post2 = models.Post(
        title="Related by Tag",
        slug="related-by-tag",
        content="Related Content",
        published=True,
    )
    post2.tags.append(tag)

    db_session.add(post1)
    db_session.add(post2)
    db_session.commit()

    response = client.get(f"/api/posts/{post1.id}/related")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1


def test_related_posts_excludes_current(client, db_session):
    """Test related posts don't include the current post."""
    post = models.Post(
        title="Test Post",
        slug="exclude-test",
        content="Content",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get(f"/api/posts/{post.id}/related")
    data = response.json()

    for related in data:
        assert related["id"] != post.id


def test_related_posts_empty_for_new_post(client, db_session):
    """Test related posts returns empty for new post with no similar posts."""
    post = models.Post(
        title="New Post",
        slug="new-post-no-relatives",
        content="Fresh content",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get(f"/api/posts/{post.id}/related")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)


# ============== Export Tests ==============
def test_export_posts_csv_with_views_likes(client, db_session):
    """Test exported CSV includes views and likes."""
    post = models.Post(
        title="Export Stats",
        slug="export-stats",
        content="Content",
        published=True,
        views=500,
        likes=100,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/export/posts.csv")
    content = response.text

    assert "Views" in content
    assert "Likes" in content
    assert "500" in content
    assert "100" in content


def test_export_posts_csv_handles_unicode(client, db_session):
    """Test CSV export handles Chinese characters."""
    post = models.Post(
        title="中文标题",
        slug="chinese-title",
        content="中文内容",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/export/posts.csv")
    assert response.status_code == 200
    # CSV should contain UTF-8 encoded Chinese
    assert "中文" in response.text


# ============== Popular Posts Tests ==============
def test_popular_posts_sorted_by_views(client, db_session):
    """Test popular posts are sorted by view count."""
    high_views = models.Post(
        title="Popular Post",
        slug="popular-high",
        content="Content",
        published=True,
        views=1000,
    )
    low_views = models.Post(
        title="Less Popular",
        slug="popular-low",
        content="Content",
        published=True,
        views=100,
    )
    db_session.add(high_views)
    db_session.add(low_views)
    db_session.commit()

    response = client.get("/api/posts/popular/list")
    data = response.json()
    assert data[0]["views"] >= data[1]["views"]


# ============== Category Tests ==============
def test_post_with_category_in_list(client, db_session):
    """Test post list includes category information."""
    category = models.Category(name="Test Category")
    db_session.add(category)
    db_session.commit()

    post = models.Post(
        title="Categorized Post",
        slug="categorized-post",
        content="Content",
        published=True,
        category_id=category.id,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/posts")
    data = response.json()

    assert data["items"][0]["category"] is not None
    assert data["items"][0]["category"]["name"] == "Test Category"


# ============== Tags Tests ==============
def test_post_with_tags_in_list(client, db_session):
    """Test post list includes tags information."""
    tag = models.Tag(name="TestTag")
    db_session.add(tag)
    db_session.commit()

    post = models.Post(
        title="Tagged Post",
        slug="tagged-post",
        content="Content",
        published=True,
    )
    post.tags.append(tag)
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/posts")
    data = response.json()

    assert len(data["items"][0]["tags"]) > 0
    assert data["items"][0]["tags"][0]["name"] == "TestTag"


# ============== Pagination Tests ==============
def test_post_list_pagination(client, db_session):
    """Test pagination in post list."""
    for i in range(15):
        post = models.Post(
            title=f"Post {i}",
            slug=f"pagination-test-{i}",
            content="Content",
            published=True,
        )
        db_session.add(post)
    db_session.commit()

    response = client.get("/api/posts?page=1&limit=10")
    data = response.json()

    assert len(data["items"]) == 10
    assert data["pagination"]["total"] == 15
    assert data["pagination"]["total_pages"] == 2


# ============== Search Tests ==============
def test_search_returns_pagination_info(client, db_session):
    """Test search API returns pagination information."""
    for i in range(12):
        post = models.Post(
            title=f"Search Test {i}",
            slug=f"search-test-{i}",
            content="Test content",
            published=True,
        )
        db_session.add(post)
    db_session.commit()

    response = client.get("/api/search?q=test")
    data = response.json()

    assert "pagination" in data


# ============== Comments Tests ==============
def test_comment_reply_to_another_comment(client, db_session):
    """Test replying to another comment."""
    post = models.Post(
        title="Comment Test",
        slug="comment-reply-test",
        content="Content",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    # Create parent comment
    parent = models.Comment(
        post_id=post.id,
        nickname="Parent",
        content="Parent comment",
    )
    db_session.add(parent)
    db_session.commit()

    # Reply to parent
    response = client.post(
        f"/api/comments/post/{post.id}",
        json={
            "nickname": "Child",
            "email": "child@test.com",
            "content": "Reply comment",
            "parent_id": parent.id,
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["parent_id"] == parent.id
