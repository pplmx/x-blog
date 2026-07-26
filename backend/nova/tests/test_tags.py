def test_create_tag(client, auth_headers):
    response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
        headers=auth_headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Tag"


def test_create_tag_duplicate(client, auth_headers):
    client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
        headers=auth_headers,
    )
    response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"


def test_list_tags(client, auth_headers):
    client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
        headers=auth_headers,
    )
    response = client.get("/api/tags")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Test Tag"


def test_get_tag(client, auth_headers):
    create_response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
        headers=auth_headers,
    )
    tag_id = create_response.json()["id"]
    response = client.get(f"/api/tags/{tag_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Test Tag"


def test_update_tag(client, auth_headers):
    create_response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
        headers=auth_headers,
    )
    tag_id = create_response.json()["id"]
    response = client.put(
        f"/api/tags/{tag_id}",
        json={"name": "Updated Tag"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Tag"


def test_delete_tag(client, auth_headers):
    create_response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
        headers=auth_headers,
    )
    tag_id = create_response.json()["id"]
    response = client.delete(
        f"/api/tags/{tag_id}",
        headers=auth_headers,
    )
    assert response.status_code == 204
    get_response = client.get(f"/api/tags/{tag_id}")
    assert get_response.status_code == 404


def test_create_tag_requires_auth(client):
    response = client.post("/api/tags", json={"name": "Unauthorized"})
    assert response.status_code == 401


def test_delete_tag_requires_auth(client):
    response = client.delete("/api/tags/999")
    assert response.status_code == 401


def test_delete_tag_with_posts_returns_400(client, auth_headers, db_session):
    """Test deleting a tag with posts returns 400, not 500."""
    from app import models

    tag = models.Tag(name="Protected Public Tag")
    db_session.add(tag)
    db_session.flush()

    post = models.Post(
        title="Post with Tag",
        slug="public-protected-tag-post",
        content="Content",
    )
    post.tags.append(tag)
    db_session.add(post)
    db_session.commit()

    response = client.delete(f"/api/tags/{tag.id}", headers=auth_headers)
    assert response.status_code == 400
    assert "referenced by posts" in response.json()["error"]["message"]


def test_update_tag_duplicate_name_returns_400(client, auth_headers, db_session):
    """Test updating a tag to a duplicate name returns 400, not 500."""
    from app import models

    tag1 = models.Tag(name="pub_tag_a")
    tag2 = models.Tag(name="pub_tag_b")
    db_session.add_all([tag1, tag2])
    db_session.commit()

    response = client.put(
        f"/api/tags/{tag2.id}",
        json={"name": "pub_tag_a"},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "already exists" in response.json()["error"]["message"]
