"""Reader self-service account deletion (DEC-303, TASK-380).

A signed-in reader can permanently delete their own account from the API
(``DELETE /api/reader/me/account``) after confirming their current password. The
deletion must be total — every reader-scoped row disappears (follows across
all three kinds, bookmarks + folders, reading history, notification rows and
prefs, push subscriptions, comment subscriptions, avatar file) — while the
reader's *comments* are anonymized rather than deleted: a signed-in reader's
name/identity is unlinked (reader_id → NULL, an additive nullable column per
DEC-009) but the discussion itself stays on the post, exactly like an
anonymous comment. Old tokens stop working (the account row is gone).
"""

from pathlib import Path

import pytest

from app.auth import ReaderAccount
from app.models import (
    BookmarkFolder,
    CategoryFollow,
    Comment,
    CommentSubscription,
    Post,
    PushSubscription,
    ReaderBookmark,
    ReaderNotification,
    ReaderNotificationPref,
    ReadingHistory,
    SeriesFollow,
    TagFollow,
)

DELETE_URL = "/api/reader/me/account"
REGISTER_URL = "/api/reader/register"
PASSWORD = "readerpass123"

pytestmark = pytest.mark.usefixtures("isolated_avatar_dir")


@pytest.fixture()
def isolated_avatar_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    from app.routers import reader as reader_module

    monkeypatch.setattr(reader_module, "AVATAR_DIR", tmp_path / "avatars")


def _register(client, tag="delete"):
    email = f"delete-{tag}@example.com"
    reg = client.post(
        REGISTER_URL,
        json={"email": email, "password": PASSWORD, "display_name": "Delete Me"},
    )
    assert reg.status_code == 201, reg.text
    token = reg.json()["access_token"]
    return email, {"Authorization": f"Bearer {token}"}, token


def _seed_side_data(db, reader_id: int, post_id: int):
    """Populate one row in every reader-scoped table (and a comment + avatar)."""
    db.add(CategoryFollow(reader_id=reader_id, category_id=1))
    db.add(TagFollow(reader_id=reader_id, tag_id=1))
    db.add(SeriesFollow(reader_id=reader_id, series_id=1))
    folder = BookmarkFolder(reader_id=reader_id, name="Saved")
    db.add(folder)
    db.flush()
    db.add(ReaderBookmark(reader_id=reader_id, post_id=post_id, folder_id=folder.id))
    db.add(ReadingHistory(reader_id=reader_id, post_id=post_id))
    db.add(CommentSubscription(reader_id=reader_id, post_id=post_id))
    db.add(
        ReaderNotification(
            reader_id=reader_id,
            kind="new_post",
            title="A new post",
            body="body",
            url=f"/posts/{post_id}",
        )
    )
    db.add(ReaderNotificationPref(reader_id=reader_id, new_post=True, reply=True, thread_comment=True))
    db.add(
        PushSubscription(
            endpoint="https://push.example/delete-test",
            p256dh="p256",
            auth="auth",
            reader_id=reader_id,
        )
    )
    db.add(Comment(post_id=post_id, nickname="Delete Me", content="keep me", reader_id=reader_id))
    db.flush()


def _reader_comment(db, reader_id: int, post_id: int) -> int:
    comment = Comment(post_id=post_id, nickname="Delete Me", content="keep me too", reader_id=reader_id)
    db.add(comment)
    db.flush()
    return comment.id


def _count(db, model):
    return db.query(model).count()


def _delete(client, headers, password=PASSWORD):
    """DELETE /api/reader/me with the current-password body (TestClient.delete
    has no `json` — httpx only bodies POST/PUT/PATCH — so use request())."""
    return client.request("DELETE", DELETE_URL, json={"password": password}, headers=headers)


def test_delete_requires_auth(client):
    resp = _delete(client, {})
    assert resp.status_code == 401


def test_delete_rejects_wrong_password_and_keeps_account(client, db_session):
    email, headers, _ = _register(client, tag="wrongpw")
    resp = _delete(client, headers, password="not-the-password")
    assert resp.status_code == 401
    # The account survives a failed attempt.
    assert db_session.query(ReaderAccount).filter(ReaderAccount.email == email).one()


def test_delete_totally_removes_the_reader_and_anonymizes_comments(client, db_session):
    from app.routers import reader as reader_module

    email, headers, _ = _register(client, tag="happy")
    reader_id = db_session.query(ReaderAccount).filter(ReaderAccount.email == email).one().id
    post = Post(title="p", slug="slug-delete", content="c", published=True)
    db_session.add(post)
    db_session.flush()
    # A second commenter ensures anonymization targets only this reader.
    other = Comment(post_id=post.id, nickname="Other", content="different", reader_id=99)
    db_session.add(other)
    _seed_side_data(db_session, reader_id, post.id)
    comment_id = _reader_comment(db_session, reader_id, post.id)
    # Give the reader an avatar file that must be reaped. The name matches the
    # avatar shape ({uuid}.ext) so _delete_avatar_file's path guard lets it.
    avatar_name = "aabbccdd-1122-3344-5566-778899aabbcc.png"
    (reader_module.AVATAR_DIR / avatar_name).parent.mkdir(parents=True, exist_ok=True)
    avatar_file = reader_module.AVATAR_DIR / avatar_name
    avatar_file.write_bytes(b"fake-image")
    reader = db_session.query(ReaderAccount).filter(ReaderAccount.email == email).one()
    reader.avatar_url = f"/static/avatars/{avatar_name}"
    db_session.commit()

    resp = _delete(client, headers)
    assert resp.status_code == 204

    # The account is gone; the token no longer works.
    assert db_session.query(ReaderAccount).filter(ReaderAccount.email == email).first() is None
    me = client.get("/api/reader/me", headers=headers)
    assert me.status_code == 401

    # Every reader-scoped row is removed.
    for model in (
        CategoryFollow,
        TagFollow,
        SeriesFollow,
        BookmarkFolder,
        ReaderBookmark,
        ReadingHistory,
        CommentSubscription,
        ReaderNotification,
        ReaderNotificationPref,
        PushSubscription,
    ):
        assert _count(db_session, model) == 0, f"leftover {model.__name__} rows"

    # Comments are anonymized, not deleted: the discussion stays, only the
    # reader linkage goes away — and unrelated commenters are untouched.
    deleted_comment = db_session.get(Comment, comment_id)
    assert deleted_comment is not None
    assert deleted_comment.reader_id is None
    assert deleted_comment.content == "keep me too"
    assert db_session.get(Comment, other.id) is not None
    assert db_session.get(Comment, other.id).reader_id == 99

    # The avatar file was reaped.
    assert not avatar_file.exists()


def test_delete_is_idempotent_per_token_invalidation(client):
    """A second DELETE with the now-deleted account's JWT is rejected."""
    _, headers, _ = _register(client, tag="twice")
    assert _delete(client, headers).status_code == 204
    assert _delete(client, headers).status_code == 401
