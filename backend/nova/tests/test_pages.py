"""Static pages (round 347): admin CRUD + public surface.

The public surface is anonymous and no-oracle (an unpublished or unknown slug
answer the same 404), admin management is any-admin (get_current_admin — an
editor can curate pages just like categories/series), writes are rate-limited
(not asserted here), and slug collisions are 409s.
"""


async def _create(client, headers, slug="privacy", title="Privacy Policy", content="## Data", published=False):
    return await client.post(
        "/api/admin/pages",
        json={"slug": slug, "title": title, "content": content, "published": published},
        headers=headers,
    )


# --- Public surface -----------------------------------------------------------


async def test_public_get_published_page(client, auth_headers):
    await _create(client, auth_headers, slug="privacy", title="Privacy Policy", content="## Data", published=True)
    resp = await client.get("/api/pages/privacy")
    assert resp.status_code == 200
    data = resp.json()
    assert data["slug"] == "privacy"
    assert data["title"] == "Privacy Policy"
    assert data["content"] == "## Data"
    assert "updated_at" in data


async def test_public_page_unpublished_404(client, auth_headers):
    # A draft must be indistinguishable from a never-created page (no-oracle).
    await _create(client, auth_headers, slug="draft", published=False)
    assert (await client.get("/api/pages/draft")).status_code == 404
    assert (await client.get("/api/pages/never-existed")).status_code == 404


async def test_public_pages_list_is_published_only(client, auth_headers):
    await _create(client, auth_headers, slug="terms", title="Terms", published=True)
    await _create(client, auth_headers, slug="contact", title="Contact", published=True)
    await _create(client, auth_headers, slug="draft", title="Draft", published=False)
    resp = await client.get("/api/pages")
    assert resp.status_code == 200
    data = resp.json()
    slugs = {item["slug"] for item in data}
    assert slugs == {"terms", "contact"}
    assert "draft" not in slugs
    # The list row is identity-only (no content body).
    for item in data:
        assert set(item.keys()) == {"slug", "title"}


# --- Admin management ---------------------------------------------------------


async def test_admin_create_page(client, auth_headers):
    resp = await _create(client, auth_headers, slug="about", title="About", content="hello", published=True)
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"]
    assert data["slug"] == "about"
    assert data["published"] is True
    assert data["content"] == "hello"


async def test_admin_create_duplicate_slug_409(client, auth_headers):
    await _create(client, auth_headers, slug="privacy")
    resp = await _create(client, auth_headers, slug="privacy", title="Other")
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "CONFLICT"


async def test_admin_create_requires_admin(client):
    assert (await _create(client, {}, slug="anon")).status_code == 401


async def test_editor_can_manage_pages(client, editor_headers):
    # get_current_admin (not superuser-only): an editor curates pages the same
    # way they curate categories/series.
    resp = await _create(client, editor_headers, slug="contact", title="Contact", published=True)
    assert resp.status_code == 201
    pid = resp.json()["id"]
    assert (await client.get("/api/pages/contact")).status_code == 200
    assert (
        await client.patch(f"/api/admin/pages/{pid}", json={"title": "Contact us"}, headers=editor_headers)
    ).status_code == 200


async def test_admin_list_includes_drafts(client, auth_headers):
    await _create(client, auth_headers, slug="published", published=True)
    await _create(client, auth_headers, slug="draft", published=False)
    resp = await client.get("/api/admin/pages", headers=auth_headers)
    assert resp.status_code == 200
    slugs = {item["slug"] for item in resp.json()}
    assert slugs == {"published", "draft"}


async def test_admin_update_fields_and_slug_swap(client, auth_headers):
    pid = (await _create(client, auth_headers, slug="privacy", title="Privacy", content="v1", published=False)).json()[
        "id"
    ]
    # Publish + edit content in one PATCH.
    resp = await client.patch(
        f"/api/admin/pages/{pid}", json={"published": True, "content": "v2"}, headers=auth_headers
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["published"] is True
    assert data["content"] == "v2"
    # Public route now serves the edited body.
    assert (await client.get("/api/pages/privacy")).json()["content"] == "v2"
    # Renaming the slug moves the public URL and 404s the old one.
    resp = await client.patch(f"/api/admin/pages/{pid}", json={"slug": "privacy-policy"}, headers=auth_headers)
    assert resp.status_code == 200
    assert (await client.get("/api/pages/privacy-policy")).status_code == 200
    assert (await client.get("/api/pages/privacy")).status_code == 404


async def test_admin_update_to_taken_slug_409(client, auth_headers):
    await _create(client, auth_headers, slug="terms", published=True)
    pid = (await _create(client, auth_headers, slug="contact", published=False)).json()["id"]
    resp = await client.patch(f"/api/admin/pages/{pid}", json={"slug": "terms"}, headers=auth_headers)
    assert resp.status_code == 409


async def test_admin_update_missing_page_404(client, auth_headers):
    resp = await client.patch("/api/admin/pages/999999", json={"title": "x"}, headers=auth_headers)
    assert resp.status_code == 404


async def test_admin_delete_removes_public_page(client, auth_headers):
    pid = (await _create(client, auth_headers, slug="changelog", title="Changelog", published=True)).json()["id"]
    assert (await client.get("/api/pages/changelog")).status_code == 200
    resp = await client.delete(f"/api/admin/pages/{pid}", headers=auth_headers)
    assert resp.status_code == 204
    assert (await client.get("/api/pages/changelog")).status_code == 404
    assert (await client.delete(f"/api/admin/pages/{pid}", headers=auth_headers)).status_code == 404


async def test_admin_delete_requires_admin(client):
    assert (await client.delete("/api/admin/pages/1")).status_code == 401
