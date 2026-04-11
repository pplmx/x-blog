

def test_search_posts(client):
    client.post(
        "/api/posts",
        json={
            "title": "Python Tutorial",
            "slug": "python-tutorial",
            "content": "Learn Python programming",
            "published": True,
        },
    )
    client.post(
        "/api/posts",
        json={
            "title": "JavaScript Guide",
            "slug": "javascript-guide",
            "content": "Learn JavaScript",
            "published": True,
        },
    )

    response = client.get("/api/search", params={"q": "Python"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["title"] == "Python Tutorial"


def test_search_pagination(client):
    client.post(
        "/api/posts",
        json={
            "title": "Python Tutorial",
            "slug": "python-tutorial",
            "content": "Learn Python programming",
            "published": True,
        },
    )
    client.post(
        "/api/posts",
        json={
            "title": "JavaScript Guide",
            "slug": "javascript-guide",
            "content": "Learn JavaScript",
            "published": True,
        },
    )

    response = client.get("/api/search", params={"q": "Learn", "limit": 1, "page": 1})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["pagination"]["total"] == 2
    assert data["pagination"]["page"] == 1
    assert data["pagination"]["limit"] == 1


def test_search_no_results(client):
    client.post(
        "/api/posts",
        json={
            "title": "Python Tutorial",
            "slug": "python-tutorial",
            "content": "Learn Python programming",
            "published": True,
        },
    )

    response = client.get("/api/search", params={"q": "Nonexistent"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 0
    assert data["pagination"]["total"] == 0


def test_search_empty_query(client):
    client.post(
        "/api/posts",
        json={
            "title": "Test",
            "slug": "test",
            "content": "Content",
            "published": True,
        },
    )

    response = client.get("/api/search?q=%20")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data


def test_search_special_characters(client, db_session):
    from app import models

    post = models.Post(
        title="Test Special",
        slug="test-special",
        content="Content with special chars: @#$%^&*()",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/search?q=@#$%")
    assert response.status_code == 200


def test_search_case_insensitive(client, db_session):
    from app import models

    post = models.Post(
        title="Hello World",
        slug="hello-world",
        content="Hello content",
        published=True,
    )
    db_session.add(post)
    db_session.commit()

    response = client.get("/api/search?q=hello")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1

    response_upper = client.get("/api/search?q=HELLO")
    data_upper = response_upper.json()
    assert len(data_upper["items"]) == 1
