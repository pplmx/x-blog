"""Tests for file upload endpoint."""

from io import BytesIO
from pathlib import Path

from PIL import Image

from app import models
from app.routers.upload import STATIC_DIR


def _image_bytes(image_format: str) -> bytes:
    """Return a tiny, genuinely decodable image of the given format (Pillow)."""
    buf = BytesIO()
    Image.new("RGB", (2, 2), (200, 30, 30)).save(buf, format=image_format)
    return buf.getvalue()


PNG_BYTES = _image_bytes("PNG")
JPEG_BYTES = _image_bytes("JPEG")
WEBP_BYTES = _image_bytes("WEBP")


def test_upload_image_success(client, auth_headers):
    """Should successfully upload a valid image file."""
    response = client.post(
        "/api/upload",
        files={"file": ("test.png", PNG_BYTES, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "url" in data
    assert data["url"].startswith("/static/uploads/")


def test_upload_jpeg_success(client, auth_headers):
    """Should accept JPEG images."""
    response = client.post(
        "/api/upload",
        files={"file": ("photo.jpg", JPEG_BYTES, "image/jpeg")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert "url" in response.json()


def test_upload_webp_success(client, auth_headers):
    """Should accept WebP images."""
    response = client.post(
        "/api/upload",
        files={"file": ("image.webp", WEBP_BYTES, "image/webp")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert "url" in response.json()


def test_upload_content_type_mismatch_rejected(client, auth_headers):
    """A PNG file declared as JPEG must be rejected (issue #20)."""
    response = client.post(
        "/api/upload",
        files={"file": ("fake.jpg", PNG_BYTES, "image/jpeg")},
        headers=auth_headers,
    )
    assert response.status_code == 400
    data = response.json()
    assert "does not match" in data["error"]["message"]


def test_upload_fake_image_content_rejected(client, auth_headers):
    """Text bytes with an image Content-Type must be rejected (issue #20)."""
    response = client.post(
        "/api/upload",
        files={"file": ("evil.png", b"not an image at all", "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 400
    data = response.json()
    assert "does not match" in data["error"]["message"]


def test_upload_corrupt_image_with_valid_magic_rejected(client, auth_headers):
    """Valid PNG magic bytes but corrupt content must be rejected.

    Magic bytes only prove the header; the Pillow decode check (round 17)
    rejects files that have the right signature but are not decodable images.
    """
    file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
    response = client.post(
        "/api/upload",
        files={"file": ("broken.png", file_content, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 400
    data = response.json()
    assert "not a valid image" in data["error"]["message"]


def test_upload_unsupported_type(client, auth_headers):
    """Should reject files with unsupported content types."""
    file_content = b"fake pdf content"
    response = client.post(
        "/api/upload",
        files={"file": ("document.pdf", file_content, "application/pdf")},
        headers=auth_headers,
    )
    assert response.status_code == 400
    # Error response is wrapped by HTTPException handler
    data = response.json()
    assert "Unsupported file type" in data["error"]["message"]


def test_upload_file_too_large(client, auth_headers):
    """Should reject files exceeding 5MB limit."""
    # Create a 6MB file (over 5MB limit)
    file_content = b"\x00" * (6 * 1024 * 1024)
    response = client.post(
        "/api/upload",
        files={"file": ("large.png", file_content, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 400
    data = response.json()
    assert "File too large" in data["error"]["message"]


def test_upload_no_file(client, auth_headers):
    """Should return 422 when no file is provided."""
    response = client.post("/api/upload", files={}, headers=auth_headers)
    assert response.status_code == 422


def test_upload_filename_path_traversal(client, auth_headers):
    """Should strip path traversal characters from filename extensions."""
    # Filename with path traversal attempt in the extension
    response = client.post(
        "/api/upload",
        files={"file": ("../../../etc/passwd.png", PNG_BYTES, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    # The URL should be a safe UUID-based filename, not contain traversal chars
    assert data["url"].startswith("/static/uploads/")
    assert ".." not in data["url"]
    assert "/etc/" not in data["url"]


def test_upload_filename_no_extension(client, auth_headers):
    """Should fall back to content-type-derived extension when filename has no ext."""
    response = client.post(
        "/api/upload",
        files={"file": ("noextension", PNG_BYTES, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["url"].endswith(".png")


def test_upload_requires_auth(client):
    """Should return 401 when no auth token is provided."""
    response = client.post(
        "/api/upload",
        files={"file": ("test.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Media library (DEC-183): GET /api/upload/files + DELETE .../files/{y}/{m}/{f}
# ---------------------------------------------------------------------------


def _upload_and_get_url(client, auth_headers) -> str:
    """Upload a valid image and return its URL. Callers delete it via the API."""
    resp = client.post(
        "/api/upload",
        files={"file": ("media.png", PNG_BYTES, "image/png")},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["url"]


def _delete_file(client, auth_headers, url: str):
    """Delete a /static/uploads/Y/M/F url via the media API."""
    parts = url.split("/")
    year, month, filename = parts[-3], parts[-2], parts[-1]
    return client.delete(f"/api/upload/files/{year}/{month}/{filename}", headers=auth_headers)


class TestMediaLibrary:
    """Admin media library: list, reference tracking, and reference-aware delete."""

    def test_list_files_requires_auth(self, client):
        resp = client.get("/api/upload/files")
        assert resp.status_code == 401

    def test_list_after_upload_returns_entry(self, client, auth_headers):
        url = _upload_and_get_url(client, auth_headers)
        try:
            resp = client.get("/api/upload/files", headers=auth_headers)
            assert resp.status_code == 200
            data = resp.json()
            assert data["pagination"]["total"] >= 1
            found = [item for item in data["items"] if item["url"] == url]
            assert len(found) == 1, f"uploaded url {url} missing from listing: {data['items']}"
            item = found[0]
            assert item["referenced"] is False
            assert item["size"] == len(PNG_BYTES)
            assert item["width"] == 2 and item["height"] == 2
        finally:
            _delete_file(client, auth_headers, url)

    def test_list_editors_can_browse(self, client, editor_headers):
        """Editors (non-superuser admins) can use the media library too."""
        url = _upload_and_get_url(client, editor_headers)
        try:
            resp = client.get("/api/upload/files", headers=editor_headers)
            assert resp.status_code == 200
            assert any(item["url"] == url for item in resp.json()["items"])
        finally:
            _delete_file(client, editor_headers, url)

    def test_referenced_image_reported(self, client, auth_headers, db_session):
        url = _upload_and_get_url(client, auth_headers)
        try:
            # A post embedding the image (markdown) makes it "referenced".
            post = models.Post(
                title="Uses upload",
                slug="uses-upload",
                content=f"![x]({url})",
                published=False,
            )
            db_session.add(post)
            db_session.commit()

            resp = client.get("/api/upload/files", headers=auth_headers)
            item = next(i for i in resp.json()["items"] if i["url"] == url)
            assert item["referenced"] is True
            assert [p["id"] for p in item["referencing_posts"]] == [post.id]
        finally:
            _delete_file(client, auth_headers, url)

    def test_cover_image_reference_reported(self, client, auth_headers, db_session):
        url = _upload_and_get_url(client, auth_headers)
        try:
            post = models.Post(
                title="Cover upload",
                slug="cover-upload",
                content="body",
                cover_image=url,
                published=False,
            )
            db_session.add(post)
            db_session.commit()

            resp = client.get("/api/upload/files", headers=auth_headers)
            item = next(i for i in resp.json()["items"] if i["url"] == url)
            assert item["referenced"] is True
        finally:
            _delete_file(client, auth_headers, url)

    def test_delete_unreferenced_succeeds(self, client, auth_headers):
        url = _upload_and_get_url(client, auth_headers)
        parts = url.split("/")
        year, month, filename = parts[-3], parts[-2], parts[-1]
        resp = client.delete(f"/api/upload/files/{year}/{month}/{filename}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        # Gone from the listing and no longer on disk.
        listing = client.get("/api/upload/files", headers=auth_headers).json()
        assert all(item["url"] != url for item in listing["items"])
        assert not (Path(STATIC_DIR) / "uploads" / year / month / filename).exists()

    def test_delete_referenced_rejected(self, client, auth_headers, db_session):
        url = _upload_and_get_url(client, auth_headers)
        try:
            post = models.Post(
                title="Ref post",
                slug="ref-post",
                content=f"![](/static/uploads{url.split('/static/uploads')[1]})",
                published=False,
            )
            db_session.add(post)
            db_session.commit()
            resp = _delete_file(client, auth_headers, url)
            assert resp.status_code == 409, resp.text
            assert "referenced by post" in resp.json()["error"]["message"]
            # Still present on disk after the refused delete.
            parts = url.split("/")
            assert (Path(STATIC_DIR) / "uploads" / parts[-3] / parts[-2] / parts[-1]).exists()
        finally:
            _delete_file(client, auth_headers, url)

    def test_delete_requires_auth(self, client):
        resp = client.delete("/api/upload/files/2026/07/00000000-0000-0000-0000-000000000000.png")
        assert resp.status_code == 401

    def test_delete_invalid_path_rejected(self, client, auth_headers):
        # Path traversal / wrong shape must never reach the filesystem. The
        # `..` forms hit Starlette before routing (extra segments don't match
        # the 3-segment route) and 404; the wrong-shape forms reach the route
        # and are 400'd by the boundary regex. Either is a refusal.
        for bad in (
            "/api/upload/files/../../etc/passwd.png",
            "/api/upload/files/2026/07/../../passwd",
        ):
            resp = client.delete(bad, headers=auth_headers)
            assert resp.status_code in (400, 404), f"{bad} -> {resp.status_code}"
        for bad in (
            "/api/upload/files/20/07/00000000-0000-0000-0000-000000000000.png",
            "/api/upload/files/2026/7/00000000-0000-0000-0000-000000000000.png",
            "/api/upload/files/2026/07/not-a-uuid.png",
            "/api/upload/files/2026/07/00000000-0000-0000-0000-000000000000.exe",
        ):
            resp = client.delete(bad, headers=auth_headers)
            assert resp.status_code == 400, f"{bad} -> {resp.status_code}"

    def test_delete_missing_file_404(self, client, auth_headers):
        resp = client.delete(
            "/api/upload/files/2026/07/00000000-0000-0000-0000-000000000000.png",
            headers=auth_headers,
        )
        assert resp.status_code == 404
