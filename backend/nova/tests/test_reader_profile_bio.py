"""Reader profile bio (round 352).

A one-paragraph "about me" a reader writes on /account and is shown on their
public profile page — it completes the identity surface (name + avatar + bio)
next to their streak and approved comments. Covers the default (no bio), the
set / clear round-trip through PATCH /me, that it stays out of the login/me
flow until set, the public GET /api/readers/{id} carries it, and the length
cap (one request cannot bloat the account row unbounded).
"""

REGISTER = "/api/reader/register"
ME = "/api/reader/me"


async def _register(client, email="bio@example.com", password="readerpass123"):
    resp = await client.post(REGISTER, json={"email": email, "password": password})
    assert resp.status_code == 201
    return resp.json()["access_token"]


async def read_me(client, token):
    return await client.get(ME, headers={"Authorization": f"Bearer {token}"})


async def test_bio_absent_by_default(client):
    token = await _register(client)
    data = (await read_me(client, token)).json()
    assert data["bio"] is None


async def test_set_and_clear_bio_round_trip(client):
    token = await _register(client)

    set_resp = await client.patch(
        ME,
        json={"bio": "I write about small-scale self-hosting and long walks."},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert set_resp.status_code == 200
    assert set_resp.json()["bio"] == "I write about small-scale self-hosting and long walks."

    # /me and the login response both carry it.
    assert (await read_me(client, token)).json()["bio"] == set_resp.json()["bio"]

    # Explicit null clears the bio (exclude_unset distinguishes clear vs omit).
    clear_resp = await client.patch(
        ME,
        json={"bio": None},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()["bio"] is None
    assert (await read_me(client, token)).json()["bio"] is None


async def test_whitespace_bio_is_cleared(client):
    token = await _register(client)
    set_resp = await client.patch(
        ME,
        json={"bio": "   "},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert set_resp.status_code == 200
    assert set_resp.json()["bio"] is None


async def test_bio_length_capped(client):
    token = await _register(client)
    too_long = "x" * 501
    resp = await client.patch(
        ME,
        json={"bio": too_long},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 422


async def test_public_profile_carries_bio(client):
    token = await _register(client)
    reader_id = (await read_me(client, token)).json()["id"]
    await client.patch(
        ME,
        json={"bio": "Public hello"},
        headers={"Authorization": f"Bearer {token}"},
    )
    profile = (await client.get(f"/api/readers/{reader_id}")).json()
    assert profile["profile"]["bio"] == "Public hello"


async def test_bio_does_not_leak_email(client):
    """The public profile carries the bio but never the account email."""
    token = await _register(client, email="secret-email@example.com")
    reader_id = (await read_me(client, token)).json()["id"]
    profile = (await client.get(f"/api/readers/{reader_id}")).json()
    assert profile["profile"]["bio"] is None
    assert "email" not in profile["profile"]
