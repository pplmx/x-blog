def test_create_category(client, auth_headers):
    response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Tech"
    assert "id" in data


def test_create_category_duplicate(client, auth_headers):
    client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"


def test_list_categories(client, auth_headers):
    client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    client.post(
        "/api/categories",
        json={
            "name": "Lifestyle",
        },
        headers=auth_headers,
    )
    response = client.get("/api/categories")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    # Each category includes a post count (0 here: no posts reference them).
    for cat in data:
        assert "post_count" in cat
        assert isinstance(cat["post_count"], int)


def test_get_category(client, auth_headers):
    create_response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]
    response = client.get(f"/api/categories/{category_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Tech"


def test_update_category(client, auth_headers):
    create_response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]
    response = client.put(
        f"/api/categories/{category_id}",
        json={"name": "Technology"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Technology"


def test_delete_category(client, auth_headers):
    create_response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]
    response = client.delete(
        f"/api/categories/{category_id}",
        headers=auth_headers,
    )
    assert response.status_code == 204
    get_response = client.get(f"/api/categories/{category_id}")
    assert get_response.status_code == 404


def test_create_category_requires_auth(client):
    response = client.post(
        "/api/categories",
        json={"name": "Unauthorized"},
    )
    assert response.status_code == 401


def test_update_category_requires_auth(client):
    response = client.put(
        "/api/categories/999",
        json={"name": "Unauthorized"},
    )
    assert response.status_code == 401


def test_delete_category_requires_auth(client):
    response = client.delete("/api/categories/999")
    assert response.status_code == 401


def test_delete_category_with_posts_returns_400(client, auth_headers, db_session):
    """Test deleting a category with posts returns 400, not 500."""
    from app import models

    category = models.Category(name="Protected Public Cat")
    db_session.add(category)
    db_session.flush()

    post = models.Post(
        title="Post with Cat",
        slug="public-protected-cat-post",
        content="Content",
        category_id=category.id,
    )
    db_session.add(post)
    db_session.commit()

    response = client.delete(f"/api/categories/{category.id}", headers=auth_headers)
    assert response.status_code == 400
    assert "referenced by posts" in response.json()["error"]["message"]


def test_update_category_duplicate_name_returns_400(client, auth_headers, db_session):
    """Test updating a category to a duplicate name returns 400, not 500."""
    from app import models

    cat1 = models.Category(name="pub_cat_a")
    cat2 = models.Category(name="pub_cat_b")
    db_session.add_all([cat1, cat2])
    db_session.commit()

    response = client.put(
        f"/api/categories/{cat2.id}",
        json={"name": "pub_cat_a"},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "already exists" in response.json()["error"]["message"]
