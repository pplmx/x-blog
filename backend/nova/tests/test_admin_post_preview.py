"""Author preview-read tests (DEC-150, TASK-187).

The admin post detail endpoint (used by the editor and the preview page) reads a
post's full detail regardless of publish state, so an author can preview how a
draft or scheduled post will render before it goes live.
"""

_n = 0


async def _create_post(client, auth_headers, title, slug, published=False, publish_at=None):
    global _n
    _n += 1
    body = {
        "title": title,
        "slug": f"{slug}-{_n}",
        "content": "# Heading\n\nsome body",
        "excerpt": "preview excerpt",
        "published": published,
    }
    if publish_at is not None:
        body["publish_at"] = publish_at
    resp = await client.post("/api/posts", json=body, headers=auth_headers)
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestAdminPostPreview:
    async def test_detail_requires_admin(self, client):
        assert (await client.get("/api/admin/posts/1")).status_code == 401

    async def test_draft_detail_readable_by_admin(self, client, auth_headers):
        post = await _create_post(client, auth_headers, "Draft Preview", "draft-preview")
        detail = await client.get(f"/api/admin/posts/{post['id']}", headers=auth_headers)
        assert detail.status_code == 200, detail.text
        data = detail.json()
        assert data["published"] is False
        assert data["title"] == "Draft Preview"
        assert "# Heading" in data["content"]
        assert data["excerpt"] == "preview excerpt"

    async def test_scheduled_detail_readable_by_admin(self, client, auth_headers):
        future = "2099-01-01T00:00:00"
        post = await _create_post(
            client, auth_headers, "Scheduled Preview", "sched-preview", published=True, publish_at=future
        )
        detail = await client.get(f"/api/admin/posts/{post['id']}", headers=auth_headers)
        assert detail.status_code == 200, detail.text
        data = detail.json()
        assert data["published"] is True
        assert data["publish_at"] == future
        assert data["title"] == "Scheduled Preview"
