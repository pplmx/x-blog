"""Reader avatar (profile picture) endpoint tests (DEC-299, TASK-378).

A reader can upload a small image that becomes their public face: it is
returned on the self view, the public reader profile, and every comment they
leave (CommentReaderProfile). Covers valid upload, type/magic/oversize
rejection, replace-and-reap of the old file, remove, and the identity wiring
into the public surfaces. Storage is isolated to a tmp dir per test via
monkeypatching reader.AVATAR_DIR (parallel of the admin upload's
isolated_upload_dir).
"""

from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from app.auth import ReaderAccount
from app.crud import approve_comment
from app.routers import reader as reader_module

AVATAR = "/api/reader/me/avatar"
PASSWORD = "readerpass123"

pytestmark = pytest.mark.usefixtures("isolated_avatar_dir")


@pytest.fixture()
def isolated_avatar_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(reader_module, "AVATAR_DIR", tmp_path / "avatars")


def _image_bytes(image_format: str) -> bytes:
    """Return a tiny, genuinely decodable image of the given format (Pillow)."""
    buf = BytesIO()
    Image.new("RGB", (2, 2), (200, 30, 30)).save(buf, format=image_format)
    return buf.getvalue()


PNG_BYTES = _image_bytes("PNG")
JPEG_BYTES = _image_bytes("JPEG")


def _register(client, tag="avatar"):
    email = f"avatar-{tag}@example.com"
    reg = client.post(
        "/api/reader/register",
        json={"email": email, "password": PASSWORD, "display_name": "Avatar User"},
    )
    assert reg.status_code == 201
    return email, reg.json()["access_token"], reg.json()["reader"]


def _create_post(client, auth_headers, slug):
    resp = client.post(
        "/api/posts",
        json={"title": f"Avatar Post {slug}", "slug": f"avatar-{slug}", "content": "content", "published": True},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _approved_comment(client, db_session, post_id, token, content):
    c = client.post(
        f"/api/comments/post/{post_id}",
        json={"nickname": "anonymous-placeholder", "email": "reader@example.com", "content": content},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert c.status_code == 201, c.text
    cid = c.json()["id"]
    approve_comment(db_session, cid, approved=True)
    return c.json()


class TestUploadAvatar:
    def test_requires_reader_token(self, client):
        resp = client.post(AVATAR, files={"file": ("a.png", PNG_BYTES, "image/png")})
        assert resp.status_code == 401

    def test_upload_png_sets_avatar_url(self, client, db_session):
        _, token, reader = _register(client, "png")
        assert reader["avatar_url"] is None
        resp = client.post(
            AVATAR,
            files={"file": ("avatar.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == reader["id"]
        assert body["avatar_url"] and body["avatar_url"].startswith("/static/avatars/")

        # Persisted on the account + served from the isolated dir.
        stored = db_session.get(ReaderAccount, reader["id"])
        assert stored.avatar_url == body["avatar_url"]
        name = body["avatar_url"].rsplit("/", 1)[-1]
        assert (reader_module.AVATAR_DIR / name).is_file()

    def test_upload_jpeg_accepted(self, client):
        _, token, reader = _register(client, "jpeg")
        resp = client.post(
            AVATAR,
            files={"file": ("photo.jpg", JPEG_BYTES, "image/jpeg")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["avatar_url"].endswith(".jpg")

    def test_upload_unsupported_type_rejected(self, client):
        _, token, _ = _register(client, "badtype")
        resp = client.post(
            AVATAR,
            files={"file": ("note.txt", b"hello", "text/plain")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_upload_fake_image_rejected(self, client):
        _, token, _ = _register(client, "fake")
        resp = client.post(
            AVATAR,
            files={"file": ("fake.png", b"not-really-an-image", "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400
        # Nothing was stored.
        if reader_module.AVATAR_DIR.exists():
            assert list(reader_module.AVATAR_DIR.glob("*")) == []

    def test_upload_oversize_rejected(self, client):
        _, token, _ = _register(client, "big")
        big = _image_bytes("PNG") * (reader_module.MAX_SIZE // 32 + 10)
        assert len(big) > reader_module.MAX_SIZE
        resp = client.post(
            AVATAR,
            files={"file": ("big.png", big, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400

    def test_replace_reaps_previous_file(self, client, db_session):
        _, token, reader = _register(client, "replace")
        first = client.post(
            AVATAR,
            files={"file": ("a.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        ).json()["avatar_url"]
        first_path = reader_module.AVATAR_DIR / first.rsplit("/", 1)[-1]
        assert first_path.is_file()

        second = client.post(
            AVATAR,
            files={"file": ("b.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        ).json()["avatar_url"]
        assert second != first
        assert not first_path.exists()  # old file reaped
        assert (reader_module.AVATAR_DIR / second.rsplit("/", 1)[-1]).is_file()

        stored = db_session.get(ReaderAccount, reader["id"])
        assert stored.avatar_url == second


class TestRemoveAvatar:
    def test_remove_clears_url_and_file(self, client):
        _, token, _ = _register(client, "rm")
        uploaded = client.post(
            AVATAR,
            files={"file": ("a.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        ).json()["avatar_url"]
        stored = reader_module.AVATAR_DIR / uploaded.rsplit("/", 1)[-1]
        assert stored.is_file()

        resp = client.delete(AVATAR, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["avatar_url"] is None
        assert not stored.exists()

    def test_remove_without_avatar_is_noop(self, client):
        _, token, _ = _register(client, "rmnone")
        resp = client.delete(AVATAR, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["avatar_url"] is None


class TestAvatarIdentitySurfaces:
    def test_avatar_on_public_reader_profile(self, client, auth_headers, db_session):
        _, token, reader = _register(client, "pub")
        client.post(
            AVATAR,
            files={"file": ("a.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp = client.get(f"/api/readers/{reader['id']}")
        assert resp.status_code == 200
        profile = resp.json()["profile"]
        assert profile["avatar_url"] and profile["avatar_url"].startswith("/static/avatars/")

    def test_avatar_on_public_comment_reader_profile(self, client, auth_headers, db_session):
        _, token, reader = _register(client, "cmt")
        client.post(
            AVATAR,
            files={"file": ("a.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        )
        post = _create_post(client, auth_headers, "cmt")
        _approved_comment(client, db_session, post["id"], token, "with avatar")
        listed = client.get(f"/api/comments/post/{post['id']}").json()["items"]
        assert listed
        reader_profiles = [c["reader"] for c in listed if c["reader"]]
        assert any(r["id"] == reader["id"] and r["avatar_url"] for r in reader_profiles)

    def test_me_returns_avatar_url(self, client):
        _, token, _ = _register(client, "me")
        client.post(
            AVATAR,
            files={"file": ("a.png", PNG_BYTES, "image/png")},
            headers={"Authorization": f"Bearer {token}"},
        )
        me = client.get("/api/reader/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["avatar_url"].startswith("/static/avatars/")
