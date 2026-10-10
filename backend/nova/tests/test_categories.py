async def test_create_category(client, auth_headers):
    response = await client.post(
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


async def test_create_category_duplicate(client, auth_headers):
    await client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    response = await client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "BAD_REQUEST"


async def test_list_categories(client, auth_headers):
    await client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    await client.post(
        "/api/categories",
        json={
            "name": "Lifestyle",
        },
        headers=auth_headers,
    )
    response = await client.get("/api/categories")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    # Each category includes a post count (0 here: no posts reference them).
    for cat in data:
        assert "post_count" in cat
        assert isinstance(cat["post_count"], int)


async def test_get_category(client, auth_headers):
    create_response = await client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]
    response = await client.get(f"/api/categories/{category_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Tech"


async def test_update_category(client, auth_headers):
    create_response = await client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]
    response = await client.put(
        f"/api/categories/{category_id}",
        json={"name": "Technology"},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Technology"


async def test_delete_category(client, auth_headers):
    create_response = await client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
        headers=auth_headers,
    )
    category_id = create_response.json()["id"]
    response = await client.delete(
        f"/api/categories/{category_id}",
        headers=auth_headers,
    )
    assert response.status_code == 204
    get_response = await client.get(f"/api/categories/{category_id}")
    assert get_response.status_code == 404


async def test_create_category_requires_auth(client):
    response = await client.post(
        "/api/categories",
        json={"name": "Unauthorized"},
    )
    assert response.status_code == 401


async def test_update_category_requires_auth(client):
    response = await client.put(
        "/api/categories/999",
        json={"name": "Unauthorized"},
    )
    assert response.status_code == 401


async def test_delete_category_requires_auth(client):
    response = await client.delete("/api/categories/999")
    assert response.status_code == 401


async def test_delete_category_with_posts_returns_400(client, auth_headers, db_session):
    """Test deleting a category with posts returns 400, not 500."""
    from app import models

    category = models.Category(name="Protected Public Cat")
    db_session.add(category)
    await db_session.flush()

    post = models.Post(
        title="Post with Cat",
        slug="public-protected-cat-post",
        content="Content",
        category_id=category.id,
    )
    db_session.add(post)
    await db_session.commit()

    response = await client.delete(f"/api/categories/{category.id}", headers=auth_headers)
    assert response.status_code == 400
    assert "referenced by posts" in response.json()["error"]["message"]


async def test_update_category_duplicate_name_returns_400(client, auth_headers, db_session):
    """Test updating a category to a duplicate name returns 400, not 500."""
    from app import models

    cat1 = models.Category(name="pub_cat_a")
    cat2 = models.Category(name="pub_cat_b")
    db_session.add_all([cat1, cat2])
    await db_session.commit()

    response = await client.put(
        f"/api/categories/{cat2.id}",
        json={"name": "pub_cat_a"},
        headers=auth_headers,
    )
    assert response.status_code == 400
    assert "already exists" in response.json()["error"]["message"]


async def test_category_post_count_excludes_drafts_and_scheduled(client, auth_headers, db_session):
    """Public /api/categories post_count must count only publicly visible posts
    (published + effective publish time passed) — drafts/scheduled must neither
    leak existence nor inflate the count (ISS-362)."""
    from app import models

    response = await client.post("/api/categories", json={"name": "VisCat"}, headers=auth_headers)
    cat = await db_session.get(models.Category, response.json()["id"])
    # One published, one draft, one scheduled-future under the same category.
    await client.post(
        "/api/posts",
        json={
            "title": "Published Visible",
            "slug": f"vis-published-{cat.id}",
            "content": "Live",
            "published": True,
            "category_id": cat.id,
        },
        headers=auth_headers,
    )
    await client.post(
        "/api/posts",
        json={
            "title": "Draft Hidden",
            "slug": f"vis-draft-{cat.id}",
            "content": "Draft",
            "published": False,
            "category_id": cat.id,
        },
        headers=auth_headers,
    )
    await client.post(
        "/api/posts",
        json={
            "title": "Scheduled Hidden",
            "slug": f"vis-sched-{cat.id}",
            "content": "Later",
            "published": True,
            "publish_at": "2099-01-01T00:00:00",
            "category_id": cat.id,
        },
        headers=auth_headers,
    )
    data = (await client.get("/api/categories")).json()
    row = next(c for c in data if c["id"] == cat.id)
    assert row["post_count"] == 1


async def test_get_category_post_count_present(client, auth_headers, db_session):
    """Single-item GET /api/categories/{id} must report the real visible count,
    not the schema default 0 (ISS-363)."""
    from app import models

    response = await client.post("/api/categories", json={"name": "ItemCat"}, headers=auth_headers)
    cat = await db_session.get(models.Category, response.json()["id"])
    await client.post(
        "/api/posts",
        json={
            "title": "In Item Cat",
            "slug": f"item-cat-{cat.id}",
            "content": "x",
            "published": True,
            "category_id": cat.id,
        },
        headers=auth_headers,
    )
    data = (await client.get(f"/api/categories/{cat.id}")).json()
    assert data["post_count"] == 1


async def test_rename_category_invalidates_posts_list_cache(client, auth_headers, db_session):
    """Renaming a category must drop the cached posts list + feed payloads that
    embed the old name, so /api/posts and /sitemap.xml stop serving the old
    name immediately instead of holding it for the 5-min TTL (ISS-364)."""
    from app import models

    cat = models.Category(name="OldName")
    db_session.add(cat)
    await db_session.flush()
    await client.post(
        "/api/posts",
        json={
            "title": "Cat Cache Post",
            "slug": "cat-cache-post",
            "content": "x",
            "published": True,
            "category_id": cat.id,
        },
        headers=auth_headers,
    )
    await db_session.commit()

    # Warm the posts list cache, then rename.
    first = (await client.get("/api/posts?limit=10")).json()
    assert first["items"][0]["category"]["name"] == "OldName"
    await client.put(f"/api/categories/{cat.id}", json={"name": "NewName"}, headers=auth_headers)

    after = (await client.get("/api/posts?limit=10")).json()
    assert after["items"][0]["category"]["name"] == "NewName"
