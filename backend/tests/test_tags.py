def test_create_tag(client):
    response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Tag"


def test_list_tags(client):
    client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
    )
    response = client.get("/api/tags")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["name"] == "Test Tag"


def test_get_tag(client):
    create_response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
    )
    tag_id = create_response.json()["id"]
    response = client.get(f"/api/tags/{tag_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Test Tag"


def test_update_tag(client):
    create_response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
    )
    tag_id = create_response.json()["id"]
    response = client.put(f"/api/tags/{tag_id}", json={"name": "Updated Tag"})
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Tag"


def test_delete_tag(client):
    create_response = client.post(
        "/api/tags",
        json={
            "name": "Test Tag",
        },
    )
    tag_id = create_response.json()["id"]
    response = client.delete(f"/api/tags/{tag_id}")
    assert response.status_code == 204
    get_response = client.get(f"/api/tags/{tag_id}")
    assert get_response.status_code == 404
