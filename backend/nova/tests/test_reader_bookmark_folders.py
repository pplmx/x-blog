"""Bookmark folder/collection API contract tests (DEC-120, TASK-172).

A signed-in reader can organize saved posts into named folders: create (with
counts), rename, delete (bookmarks become uncategorized), file bookmarks into a
folder, and filter the bookmark list by folder. Ownership is scoped per reader
throughout; public-visibility book-list invariants are preserved.
"""

BOOKMARKS = "/api/reader/me/bookmarks"
FOLDERS = f"{BOOKMARKS}/folders"


def _register(client, email="folder@example.com", password="readerpass123"):
    return client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


def _token(client, email="folder@example.com"):
    return _register(client, email=email).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


def _create_post(db_session, *, published=True, draft=False, **overrides):
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return create_post(
        db_session,
        PostCreate(
            **{
                "title": "Folderable post",
                "slug": f"bkmk-{_slug_counter}",
                "content": "# Hello\n\nWorld",
                "published": False if draft else published,
                **overrides,
            }
        ),
    )


def _make_folder(client, token, name):
    return client.post(FOLDERS, json={"name": name}, headers=_auth(token))


class TestAuthRequired:
    def test_list_folders_requires_token(self, client):
        assert client.get(FOLDERS).status_code == 401

    def test_create_folder_requires_token(self, client):
        assert client.post(FOLDERS, json={"name": "X"}).status_code == 401

    def test_assign_folder_requires_token(self, client):
        assert client.patch(f"{BOOKMARKS}/1/folder", json={"folder_id": 1}).status_code == 401

    def test_admin_token_rejected(self, client, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        assert client.get(FOLDERS, headers=headers).status_code == 401


class TestCreateFolder:
    def test_create_returns_201_and_lists(self, client):
        token = _token(client)
        resp = _make_folder(client, token, "Go")
        assert resp.status_code == 201, resp.text
        assert resp.json()["name"] == "Go"
        listed = client.get(FOLDERS, headers=_auth(token)).json()
        assert listed["total"] == 1
        assert listed["items"][0]["name"] == "Go"
        assert listed["items"][0]["count"] == 0

    def test_create_same_name_is_idempotent(self, client):
        token = _token(client)
        assert _make_folder(client, token, "Go").status_code == 201
        again = _make_folder(client, token, "Go")
        assert again.status_code == 200
        assert client.get(FOLDERS, headers=_auth(token)).json()["total"] == 1

    def test_folders_isolated_between_readers(self, client):
        t1 = _token(client, email="fiso1@example.com")
        t2 = _token(client, email="fiso2@example.com")
        _make_folder(client, t1, "Mine")
        assert client.get(FOLDERS, headers=_auth(t1)).json()["total"] == 1
        assert client.get(FOLDERS, headers=_auth(t2)).json()["total"] == 0


class TestRenameFolder:
    def test_rename(self, client):
        token = _token(client)
        fid = _make_folder(client, token, "Old").json()["id"]
        resp = client.patch(f"{FOLDERS}/{fid}", json={"name": "New"}, headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "New"

    def test_rename_duplicate_409(self, client):
        token = _token(client)
        _make_folder(client, token, "A")
        fid = _make_folder(client, token, "B").json()["id"]
        resp = client.patch(f"{FOLDERS}/{fid}", json={"name": "A"}, headers=_auth(token))
        assert resp.status_code == 409

    def test_rename_unknown_404(self, client):
        token = _token(client)
        resp = client.patch(f"{FOLDERS}/999999", json={"name": "X"}, headers=_auth(token))
        assert resp.status_code == 404


class TestDeleteFolder:
    def test_delete_uncategorized_its_bookmarks(self, client, db_session):
        token = _token(client)
        fid = _make_folder(client, token, "F").json()["id"]
        post = _create_post(db_session)
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        # Assign the bookmark to the folder.
        client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))
        listed = client.get(BOOKMARKS, headers=_auth(token)).json()
        assert listed["items"][0]["folder_id"] == fid

        assert client.delete(f"{FOLDERS}/{fid}", headers=_auth(token)).status_code == 204
        # Bookmark survives, now uncategorized (no dangling folder_id).
        assert client.get(BOOKMARKS, headers=_auth(token)).json()["items"][0]["folder_id"] is None

    def test_delete_unknown_idempotent_204(self, client):
        token = _token(client)
        assert client.delete(f"{FOLDERS}/999999", headers=_auth(token)).status_code == 204


class TestAssignAndFilter:
    def test_assign_folder_and_filter_by_it(self, client, db_session):
        token = _token(client)
        fid = _make_folder(client, token, "Tech").json()["id"]
        p1 = _create_post(db_session, title="Go Post")
        p2 = _create_post(db_session, title="Vue Post")
        client.put(f"{BOOKMARKS}/{p1.id}", headers=_auth(token))
        client.put(f"{BOOKMARKS}/{p2.id}", headers=_auth(token))
        client.patch(f"{BOOKMARKS}/{p1.id}/folder", json={"folder_id": fid}, headers=_auth(token))

        all_items = client.get(BOOKMARKS, headers=_auth(token)).json()["items"]
        by_id = {i["id"]: i for i in all_items}
        assert by_id[p1.id]["folder_id"] == fid
        assert by_id[p1.id]["folder_name"] == "Tech"
        assert by_id[p2.id]["folder_id"] is None

        filtered = client.get(f"{BOOKMARKS}?folder_id={fid}", headers=_auth(token)).json()
        assert filtered["total"] == 1
        assert filtered["items"][0]["id"] == p1.id

        # Folder counts reflect the assignment.
        folders = client.get(FOLDERS, headers=_auth(token)).json()["items"]
        assert [f for f in folders if f["id"] == fid][0]["count"] == 1

    def test_clear_folder_assignment(self, client, db_session):
        token = _token(client)
        fid = _make_folder(client, token, "F").json()["id"]
        post = _create_post(db_session)
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))
        resp = client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": None}, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["folder_id"] is None

    def test_assign_invalid_folder_404(self, client, db_session):
        token = _token(client)
        post = _create_post(db_session)
        client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        # A folder that exists for another reader must not be assignable.
        other = _token(client, email="other@example.com")
        other_fid = _make_folder(client, other, "Other").json()["id"]
        resp = client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": other_fid}, headers=_auth(token))
        assert resp.status_code == 404

    def test_assign_unbookmarked_post_404(self, client, db_session):
        token = _token(client)
        fid = _make_folder(client, token, "F").json()["id"]
        post = _create_post(db_session)  # not bookmarked
        resp = client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))
        assert resp.status_code == 404
