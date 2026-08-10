"""Tests for file upload endpoint."""

from io import BytesIO

from PIL import Image


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
