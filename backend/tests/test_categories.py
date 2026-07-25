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
