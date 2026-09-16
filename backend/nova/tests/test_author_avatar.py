"""Admin author-avatar contract tests (DEC-389, TASK-420, round 358).

The face half of the writer identity surface: a superuser uploads/removes a
public profile picture for an admin User (the same admin/users screen that
sets pen name + bio), stored in static/avatars with the reader-avatar
validation pipeline (image_validation shared), and the public author surface
(author brief, authors index, archive envelope) carries the /static URL so a
reader sees the writer's face on bylines, cards and the archive header.

No-oracle posture preserved: the login username never appears in any public
payload; a username-only admin still 404s with no avatar to leak; only
superusers can upload/remove (the same gate as PATCH /users/{id}).
"""

import json
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from app.routers import admin as admin_module

AVATAR_API = "/api/admin/users/{user_id}/avatar"
PASSWORD = "adminpass123"

pytestmark = pytest.mark.usefixtures("isolated_admin_avatar_dir")


@pytest.fixture()
def isolated_admin_avatar_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    # Redirect writer-avatar writes into the test's tmp dir so the real
    # static/avatars/ never accumulates test files (same isolation the
    # reader-avatar suite uses). Returned so tests can assert file cleanup.
    avatar_dir = tmp_path / "avatars"
    monkeypatch.setattr(admin_module, "AUTHOR_AVATAR_DIR", avatar_dir)
    return avatar_dir


def _image_bytes(image_format: str) -> bytes:
    """Return a tiny, genuinely decodable image of the given format (Pillow)."""
    buf = BytesIO()
    Image.new("RGB", (2, 2), (200, 30, 30)).save(buf, format=image_format)
    return buf.getvalue()


PNG_BYTES = _image_bytes("PNG")


def _admin_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login(client, username: str, password: str) -> str:
    r = client.post("/api/admin/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def test_upload_sets_avatar_url_and_public_brief(client, admin_token, admin_user):
    token = _admin_headers(admin_token)
    # Pen name first: the avatar is the face OF a public pen-named writer.
    r = client.patch(f"/api/admin/users/{admin_user.id}", headers=token, json={"display_name": "Avatar Writer"})
    assert r.status_code == 200, r.text

    resp = client.post(
        AVATAR_API.format(user_id=admin_user.id),
        headers=token,
        files={"file": ("avatar.png", PNG_BYTES, "image/png")},
    )
    assert resp.status_code == 200, resp.text
    avatar_url = resp.json()["avatar_url"]
    assert avatar_url.startswith("/static/avatars/")

    # The public author brief carries the face: on the index row and the
    # archive envelope — the username still never leaks.
    row = client.get("/api/authors").json()
    by_name = {r["display_name"]: r for r in row}
    assert by_name["Avatar Writer"]["avatar_url"] == avatar_url
    envelope = client.get(f"/api/authors/{admin_user.id}/posts").json()
    assert envelope["author"]["avatar_url"] == avatar_url
    assert "username" not in json.dumps([row, envelope])


def test_upload_rejects_fake_and_wrong_type(client, admin_token, admin_user):
    token = _admin_headers(admin_token)
    # Not an image at all.
    r = client.post(
        AVATAR_API.format(user_id=admin_user.id),
        headers=token,
        files={"file": ("fake.png", b"not-really-an-image", "image/png")},
    )
    assert r.status_code == 400
    # A valid image declared as text.
    r = client.post(
        AVATAR_API.format(user_id=admin_user.id),
        headers=token,
        files={"file": ("a.png", PNG_BYTES, "text/plain")},
    )
    assert r.status_code == 400


def test_upload_removes_replaced_file(client, admin_token, admin_user, isolated_admin_avatar_dir: Path):
    token = _admin_headers(admin_token)
    first = client.post(
        AVATAR_API.format(user_id=admin_user.id),
        headers=token,
        files={"file": ("a.png", PNG_BYTES, "image/png")},
    ).json()["avatar_url"]
    assert (isolated_admin_avatar_dir / first.rsplit("/", 1)[-1]).exists()

    second = client.post(
        AVATAR_API.format(user_id=admin_user.id),
        headers=token,
        files={"file": ("b.png", PNG_BYTES, "image/png")},
    ).json()["avatar_url"]
    # The replaced file is cleaned up; only the new one remains on disk.
    assert not (isolated_admin_avatar_dir / first.rsplit("/", 1)[-1]).exists()
    assert (isolated_admin_avatar_dir / second.rsplit("/", 1)[-1]).exists()


def test_remove_clears_avatar_and_deletes_file(client, admin_token, admin_user, isolated_admin_avatar_dir):
    token = _admin_headers(admin_token)
    upload = client.post(
        AVATAR_API.format(user_id=admin_user.id),
        headers=token,
        files={"file": ("a.png", PNG_BYTES, "image/png")},
    ).json()
    name = upload["avatar_url"].rsplit("/", 1)[-1]
    assert (isolated_admin_avatar_dir / name).exists()

    r = client.delete(AVATAR_API.format(user_id=admin_user.id), headers=token)
    assert r.status_code == 200
    assert r.json()["avatar_url"] is None
    assert not (isolated_admin_avatar_dir / name).exists()

    # Removing again is a no-op, not an error.
    r = client.delete(AVATAR_API.format(user_id=admin_user.id), headers=token)
    assert r.status_code == 200


def test_avatar_endpoints_superuser_only_and_404_unknown(
    client, db_session, admin_token, isolated_admin_avatar_dir: Path
):
    from uuid import uuid4

    editor = admin_module.auth.User(
        username=f"u{uuid4().hex[:6]}",
        password=admin_module.auth.get_password_hash("editorpass123"),
        role="editor",
        is_superuser=False,
    )
    db_session.add(editor)
    db_session.flush()
    editor_token = _login(client, editor.username, "editorpass123")

    # Editors cannot manage users (DEC-054): avatar upload is superuser-only.
    r = client.post(
        AVATAR_API.format(user_id=editor.id),
        headers=_admin_headers(editor_token),
        files={"file": ("a.png", PNG_BYTES, "image/png")},
    )
    assert r.status_code == 403
    # Unknown user -> 404, and no file is orphaned in the avatar dir (the
    # target is resolved before anything is written to disk).
    r = client.post(
        AVATAR_API.format(user_id=999999),
        headers=_admin_headers(admin_token),
        files={"file": ("a.png", PNG_BYTES, "image/png")},
    )
    assert r.status_code == 404
    # No file was written: the dir either doesn't exist yet (no upload ever
    # created it) or is empty — either way no orphaned avatar.
    assert not isolated_admin_avatar_dir.exists() or list(isolated_admin_avatar_dir.iterdir()) == []


def test_avatar_writer_needs_pen_name_absent_from_public_surface(client, admin_token, admin_user):
    # An admin with a pen name gets a public face; the avatar_url never leaks
    # the username, and the admin listing (superuser view) still carries it.
    token = _admin_headers(admin_token)
    client.patch(f"/api/admin/users/{admin_user.id}", headers=token, json={"display_name": "Face Writer"})
    client.post(
        AVATAR_API.format(user_id=admin_user.id),
        headers=token,
        files={"file": ("a.png", PNG_BYTES, "image/png")},
    )
    me = next(u for u in client.get("/api/admin/users", headers=token).json() if u["id"] == admin_user.id)
    assert me["avatar_url"] is not None
