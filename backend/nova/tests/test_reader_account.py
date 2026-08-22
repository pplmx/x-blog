"""Reader self-service account deletion tests (DEC-106, TASK-165).

Deleting an account requires the current password, removes the reader's
cloud bookmarks/thread subscriptions, anonymizes their past comments
(identity detached, discussion kept public) and makes the account unusable.
"""

from app import models
from app.auth import ReaderAccount
from app.crud import approve_comment, create_post
from app.schemas import PostCreate

PASSWORD = "readerpass123"


def _seed(client, db_session, tag):
    post = create_post(
        db_session,
        PostCreate(title="Acct Post", slug=f"acct-{tag}", content="# Hi", published=True),
    )
    email = f"acct-{tag}@example.com"
    reg = client.post(
        "/api/reader/register",
        json={"email": email, "password": PASSWORD, "display_name": "Acct User"},
    )
    assert reg.status_code == 201
    token = reg.json()["access_token"]
    reader_id = reg.json()["reader"]["id"]
    headers = {"Authorization": f"Bearer {token}"}

    created = client.post(
        f"/api/comments/post/{post.id}",
        json={"nickname": "x", "email": "x@x.com", "content": "account comment"},
        headers=headers,
    )
    comment_id = created.json()["id"]
    approve_comment(db_session, comment_id, approved=True)  # publicly visible

    # Seed private account data directly.
    db_session.add(models.ReaderBookmark(reader_id=reader_id, post_id=post.id))
    db_session.add(models.CommentSubscription(reader_id=reader_id, post_id=post.id))
    db_session.commit()
    return post, email, reader_id, comment_id, headers


class TestDeleteAccount:
    def test_wrong_password_401(self, client, db_session):
        _post, _email, _rid, _cid, headers = _seed(client, db_session, "wrongpw")
        resp = client.delete("/api/reader/me/account", json={"password": "not-the-password"}, headers=headers)
        assert resp.status_code == 401

    def test_requires_reader_token(self, client, db_session):
        resp = client.delete("/api/reader/me/account", json={"password": PASSWORD})
        assert resp.status_code == 401

    def test_deletes_account_and_anonymizes_comments(self, client, db_session):
        post, email, reader_id, comment_id, headers = _seed(client, db_session, "delete1")

        resp = client.delete("/api/reader/me/account", json={"password": PASSWORD}, headers=headers)
        assert resp.status_code == 204, resp.text

        # Account is gone; the reader can no longer log in.
        assert db_session.get(ReaderAccount, reader_id) is None
        login = client.post("/api/reader/login", json={"email": email, "password": PASSWORD})
        assert login.status_code == 401

        # The comment is still public/approved but its identity is detached.
        listed = client.get(f"/api/comments/post/{post.id}").json()["items"]
        item = next(c for c in listed if c["id"] == comment_id)
        assert item["reader"] is None
        assert item["content"] == "account comment"
        row = db_session.get(models.Comment, comment_id)
        assert row is not None
        assert row.reader_id is None
        assert row.nickname == "Acct User"

        # Cloud bookmarks + thread subscriptions are removed.
        assert db_session.query(models.ReaderBookmark).filter(models.ReaderBookmark.reader_id == reader_id).count() == 0
        assert (
            db_session.query(models.CommentSubscription)
            .filter(models.CommentSubscription.reader_id == reader_id)
            .count()
            == 0
        )
