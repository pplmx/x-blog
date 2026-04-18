"""Tests for file upload endpoint."""



def test_upload_image_success(client):
    """Should successfully upload a valid image file."""
    file_content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100  # Fake PNG header
    response = client.post(
        "/api/upload",
        files={"file": ("test.png", file_content, "image/png")},
    )
    assert response.status_code == 200
    data = response.json()
    assert "url" in data
    assert data["url"].startswith("/static/uploads/")


def test_upload_jpeg_success(client):
    """Should accept JPEG images."""
    file_content = b"\xff\xd8\xff\xe0" + b"\x00" * 100  # Fake JPEG header
    response = client.post(
        "/api/upload",
        files={"file": ("photo.jpg", file_content, "image/jpeg")},
    )
    assert response.status_code == 200
    assert "url" in response.json()


def test_upload_webp_success(client):
    """Should accept WebP images."""
    file_content = b"RIFF" + b"\x00" * 100  # Fake WebP header
    response = client.post(
        "/api/upload",
        files={"file": ("image.webp", file_content, "image/webp")},
    )
    assert response.status_code == 200
    assert "url" in response.json()


def test_upload_unsupported_type(client):
    """Should reject files with unsupported content types."""
    file_content = b"fake pdf content"
    response = client.post(
        "/api/upload",
        files={"file": ("document.pdf", file_content, "application/pdf")},
    )
    assert response.status_code == 400
    # Error response is wrapped by HTTPException handler
    data = response.json()
    assert "Unsupported file type" in data["error"]["message"]


def test_upload_file_too_large(client):
    """Should reject files exceeding 5MB limit."""
    # Create a 6MB file (over 5MB limit)
    file_content = b"\x00" * (6 * 1024 * 1024)
    response = client.post(
        "/api/upload",
        files={"file": ("large.png", file_content, "image/png")},
    )
    assert response.status_code == 400
    data = response.json()
    assert "File too large" in data["error"]["message"]


def test_upload_no_file(client):
    """Should return 422 when no file is provided."""
    response = client.post("/api/upload", files={})
    assert response.status_code == 422
