"""Bookmark folder/collection API contract tests (DEC-120, TASK-172).

A signed-in reader can organize saved posts into named folders: create (with
counts), rename, delete (bookmarks become uncategorized), file bookmarks into a
folder, and filter the bookmark list by folder. Ownership is scoped per reader
throughout; public-visibility book-list invariants are preserved.
"""

BOOKMARKS = "/api/reader/me/bookmarks"
FOLDERS = f"{BOOKMARKS}/folders"


async def _register(client, email="folder@example.com", password="readerpass123"):
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


async def _token(client, email="folder@example.com"):
    return (await _register(client, email=email)).json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


_slug_counter = 0


async def _create_post(db_session, *, published=True, draft=False, **overrides):
    from app.crud import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    return await create_post(
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


async def _make_folder(client, token, name):
    return await client.post(FOLDERS, json={"name": name}, headers=_auth(token))


class TestAuthRequired:
    async def test_list_folders_requires_token(self, client):
        assert (await client.get(FOLDERS)).status_code == 401

    async def test_create_folder_requires_token(self, client):
        assert (await client.post(FOLDERS, json={"name": "X"})).status_code == 401

    async def test_assign_folder_requires_token(self, client):
        assert (await client.patch(f"{BOOKMARKS}/1/folder", json={"folder_id": 1})).status_code == 401

    async def test_admin_token_rejected(self, client, admin_token):
        headers = {"Authorization": f"Bearer {admin_token}"}
        assert (await client.get(FOLDERS, headers=headers)).status_code == 401


class TestFolderIdOverflowCaps:
    """Folder/subscription ids are bounded by IdInt, so a >bigint id in a path
    or query param is a 422 on every backend — not a Postgres-only DataError
    500 (backend deep-dive, ISS-448)."""

    BIG_ID = "99999999999999999999999999"

    async def test_rename_folder_huge_id_is_422(self, client):
        token = await _token(client)
        assert (
            await client.patch(f"{FOLDERS}/{self.BIG_ID}", json={"name": "Y"}, headers=_auth(token))
        ).status_code == 422

    async def test_delete_folder_huge_id_is_422(self, client):
        token = await _token(client)
        assert (await client.delete(f"{FOLDERS}/{self.BIG_ID}", headers=_auth(token))).status_code == 422

    async def test_list_bookmarks_huge_folder_query_is_422(self, client):
        token = await _token(client)
        assert (await client.get(f"{BOOKMARKS}?folder_id={self.BIG_ID}", headers=_auth(token))).status_code == 422


class TestCreateFolder:
    async def test_create_returns_201_and_lists(self, client):
        token = await _token(client)
        resp = await _make_folder(client, token, "Go")
        assert resp.status_code == 201, resp.text
        assert resp.json()["name"] == "Go"
        listed = (await client.get(FOLDERS, headers=_auth(token))).json()
        assert listed["total"] == 1
        assert listed["items"][0]["name"] == "Go"
        assert listed["items"][0]["count"] == 0

    async def test_create_same_name_is_idempotent(self, client):
        token = await _token(client)
        assert (await _make_folder(client, token, "Go")).status_code == 201
        again = await _make_folder(client, token, "Go")
        assert again.status_code == 200
        assert (await client.get(FOLDERS, headers=_auth(token))).json()["total"] == 1

    async def test_create_folder_name_with_nul_is_422(self, client):
        """A NUL in a folder name would crash psycopg at bind -> 500; the
        FolderCreate schema must gate it with 422 (ISS-454, TASK-351)."""
        token = await _token(client)
        resp = await _make_folder(client, token, "na\x00me")
        assert resp.status_code == 422, resp.text

    async def test_create_folder_whitespace_only_name_is_422(self, client):
        """'   ' passed min_length=1 and was stored as "" by crud's strip — a
        blank folder in the reader's list. Strip at the boundary (ISS-456)."""
        token = await _token(client)
        resp = await _make_folder(client, token, "   ")
        assert resp.status_code == 422, resp.text
        assert (await client.get(FOLDERS, headers=_auth(token))).json()["total"] == 0

    async def test_folders_isolated_between_readers(self, client):
        t1 = await _token(client, email="fiso1@example.com")
        t2 = await _token(client, email="fiso2@example.com")
        await _make_folder(client, t1, "Mine")
        assert (await client.get(FOLDERS, headers=_auth(t1))).json()["total"] == 1
        assert (await client.get(FOLDERS, headers=_auth(t2))).json()["total"] == 0


class TestRenameFolder:
    async def test_rename(self, client):
        token = await _token(client)
        fid = (await _make_folder(client, token, "Old")).json()["id"]
        resp = await client.patch(f"{FOLDERS}/{fid}", json={"name": "New"}, headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "New"

    async def test_rename_duplicate_409(self, client):
        token = await _token(client)
        await _make_folder(client, token, "A")
        fid = (await _make_folder(client, token, "B")).json()["id"]
        resp = await client.patch(f"{FOLDERS}/{fid}", json={"name": "A"}, headers=_auth(token))
        assert resp.status_code == 409

    async def test_rename_unknown_404(self, client):
        token = await _token(client)
        resp = await client.patch(f"{FOLDERS}/999999", json={"name": "X"}, headers=_auth(token))
        assert resp.status_code == 404


class TestDeleteFolder:
    async def test_delete_uncategorized_its_bookmarks(self, client, db_session):
        token = await _token(client)
        fid = (await _make_folder(client, token, "F")).json()["id"]
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        # Assign the bookmark to the folder.
        await client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))
        listed = (await client.get(BOOKMARKS, headers=_auth(token))).json()
        assert listed["items"][0]["folder_id"] == fid

        assert (await client.delete(f"{FOLDERS}/{fid}", headers=_auth(token))).status_code == 204
        # Bookmark survives, now uncategorized (no dangling folder_id).
        assert (await client.get(BOOKMARKS, headers=_auth(token))).json()["items"][0]["folder_id"] is None

    async def test_delete_unknown_idempotent_204(self, client):
        token = await _token(client)
        assert (await client.delete(f"{FOLDERS}/999999", headers=_auth(token))).status_code == 204


class TestAssignAndFilter:
    async def test_assign_folder_and_filter_by_it(self, client, db_session):
        token = await _token(client)
        fid = (await _make_folder(client, token, "Tech")).json()["id"]
        p1 = await _create_post(db_session, title="Go Post")
        p2 = await _create_post(db_session, title="Vue Post")
        await client.put(f"{BOOKMARKS}/{p1.id}", headers=_auth(token))
        await client.put(f"{BOOKMARKS}/{p2.id}", headers=_auth(token))
        await client.patch(f"{BOOKMARKS}/{p1.id}/folder", json={"folder_id": fid}, headers=_auth(token))

        all_items = (await client.get(BOOKMARKS, headers=_auth(token))).json()["items"]
        by_id = {i["id"]: i for i in all_items}
        assert by_id[p1.id]["folder_id"] == fid
        assert by_id[p1.id]["folder_name"] == "Tech"
        assert by_id[p2.id]["folder_id"] is None

        filtered = (await client.get(f"{BOOKMARKS}?folder_id={fid}", headers=_auth(token))).json()
        assert filtered["total"] == 1
        assert filtered["items"][0]["id"] == p1.id

        # Folder counts reflect the assignment.
        folders = (await client.get(FOLDERS, headers=_auth(token))).json()["items"]
        assert [f for f in folders if f["id"] == fid][0]["count"] == 1

    async def test_clear_folder_assignment(self, client, db_session):
        token = await _token(client)
        fid = (await _make_folder(client, token, "F")).json()["id"]
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        await client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))
        resp = await client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": None}, headers=_auth(token))
        assert resp.status_code == 200
        assert resp.json()["folder_id"] is None

    async def test_assign_invalid_folder_404(self, client, db_session):
        token = await _token(client)
        post = await _create_post(db_session)
        await client.put(f"{BOOKMARKS}/{post.id}", headers=_auth(token))
        # A folder that exists for another reader must not be assignable.
        other = await _token(client, email="other@example.com")
        other_fid = (await _make_folder(client, other, "Other")).json()["id"]
        resp = await client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": other_fid}, headers=_auth(token))
        assert resp.status_code == 404

    async def test_assign_unbookmarked_post_404(self, client, db_session):
        token = await _token(client)
        fid = (await _make_folder(client, token, "F")).json()["id"]
        post = await _create_post(db_session)  # not bookmarked
        resp = await client.patch(f"{BOOKMARKS}/{post.id}/folder", json={"folder_id": fid}, headers=_auth(token))
        assert resp.status_code == 404
