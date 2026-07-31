"""Tests for file upload endpoint."""


def test_upload_image_success(client, auth_headers):
    """Should successfully upload a valid image file."""
    file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100  # Fake PNG header
    response = client.post(
        "/api/upload",
        files={"file": ("test.png", file_content, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert "url" in data
    assert data["url"].startswith("/static/uploads/")


def test_upload_jpeg_success(client, auth_headers):
    """Should accept JPEG images."""
    file_content = b"\xff\xd8\xff\xe0" + b"\x00" * 100  # Fake JPEG header
    response = client.post(
        "/api/upload",
        files={"file": ("photo.jpg", file_content, "image/jpeg")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert "url" in response.json()


def test_upload_webp_success(client, auth_headers):
    """Should accept WebP images."""
    # RIFF container + WEBP tag at bytes 8..12
    file_content = b"RIFF" + b"\x00" * 4 + b"WEBP" + b"\x00" * 100
    response = client.post(
        "/api/upload",
        files={"file": ("image.webp", file_content, "image/webp")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert "url" in response.json()


def test_upload_content_type_mismatch_rejected(client, auth_headers):
    """A PNG file declared as JPEG must be rejected (issue #20)."""
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    response = client.post(
        "/api/upload",
        files={"file": ("fake.jpg", png_bytes, "image/jpeg")},
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
    file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    # Filename with path traversal attempt in the extension
    response = client.post(
        "/api/upload",
        files={"file": ("../../../etc/passwd.png", file_content, "image/png")},
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
    file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    response = client.post(
        "/api/upload",
        files={"file": ("noextension", file_content, "image/png")},
        headers=auth_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["url"].endswith(".png")


def test_upload_requires_auth(client):
    """Should return 401 when no auth token is provided."""
    file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    response = client.post(
        "/api/upload",
        files={"file": ("test.png", file_content, "image/png")},
    )
    assert response.status_code == 401
