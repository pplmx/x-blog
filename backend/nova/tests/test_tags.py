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
    assert "post_count" in data[0]
    assert isinstance(data[0]["post_count"], int)


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


def test_tag_post_count_excludes_drafts_and_scheduled(client, auth_headers, db_session):
    """Public /api/tags post_count counts only publicly visible posts — a
    draft or scheduled-future post under a tag must not leak existence or
    inflate the count (ISS-362)."""
    from datetime import datetime

    from app import models

    tag_resp = client.post("/api/tags", json={"name": "VisTag"}, headers=auth_headers)
    tag_id = tag_resp.json()["id"]
    # Wire posts to the tag through the DB (the public API takes tag names on
    # create, so seed the junction directly for precision). The db_session
    # fixture is the test transaction; committing through it is the same
    # session the client override uses.
    tag = db_session.get(models.Tag, tag_id)
    publ = models.Post(title="Pub", slug="vis-tag-pub", content="x", published=True)
    publ.tags.append(tag)
    db_session.add(publ)
    draft = models.Post(title="Draft", slug="vis-tag-draft", content="x", published=False)
    draft.tags.append(tag)
    db_session.add(draft)
    sched = models.Post(
        title="Sched", slug="vis-tag-sched", content="x", published=True, publish_at=datetime(2099, 1, 1)
    )
    sched.tags.append(tag)
    db_session.add(sched)
    db_session.commit()
    data = client.get("/api/tags").json()
    row = next(t for t in data if t["id"] == tag_id)
    assert row["post_count"] == 1


def test_get_tag_post_count_present(client, auth_headers, db_session):
    """Single-item GET /api/tags/{id} must report the real visible count, not
    the schema default 0 (ISS-363)."""
    from app import models

    tag_id = client.post("/api/tags", json={"name": "ItemTag"}, headers=auth_headers).json()["id"]
    tag = db_session.get(models.Tag, tag_id)
    p = models.Post(title="Pub", slug="item-tag-pub", content="x", published=True)
    p.tags.append(tag)
    db_session.add(p)
    db_session.commit()
    data = client.get(f"/api/tags/{tag_id}").json()
    assert data["post_count"] == 1
