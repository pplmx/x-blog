"""Reader account self-service contract tests (DEC-067, TASK-141).

A reader who registered (open signup, no email recovery) can maintain their
own account: update the display name, change the password (verifying the
current one, revoking other sessions via token_version), and inspect / revoke
the browser push subscriptions bound to their account.

Key properties:
- PATCH /api/reader/me updates display_name (validated, email immutable);
- POST /api/reader/me/password requires the current password, validates the
  new one (8..72), bumps token_version so all pre-change tokens are rejected,
  and returns a fresh token;
- GET /api/reader/me/push-subscriptions lists only the caller's bound
  subscriptions (endpoint + created_at, no encryption keys);
- DELETE /api/reader/me/push-subscriptions/{id} revokes the caller's
  subscription; another reader's / unknown id 404s.
"""

from sqlalchemy import select

from app.schemas import PostCreate


async def _post(db_session, slug="self-service-post"):
    from app.crud import create_post

    return await create_post(db_session, PostCreate(title="SS", slug=slug, content="# Hi", published=True))


async def _register(client, email="ss@example.com", display_name="Orig"):
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": "readerpass123", "display_name": display_name},
    )


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _valid_p256dh():
    """65-byte uncompressed EC point as base64url (the shape the push router
    requires for p256dh)."""
    import base64

    from cryptography.hazmat.primitives.asymmetric import ec

    k = ec.generate_private_key(ec.SECP256R1())
    p = k.public_key().public_numbers()
    raw = b"\x04" + p.x.to_bytes(32, "big") + p.y.to_bytes(32, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


async def _subscribe(client, headers, endpoint="https://fcm.example.com/self"):
    return await client.post(
        "/api/push/subscribe",
        json={
            "endpoint": endpoint,
            "keys": {
                "p256dh": _valid_p256dh(),
                "auth": "B" * 22,  # 16 raw bytes, base64url
            },
        },
        headers=headers,
    )


class TestReaderProfileUpdate:
    async def test_update_display_name(self, client, db_session):
        token = (await _register(client, display_name="Old")).json()["access_token"]
        resp = await client.patch("/api/reader/me", json={"display_name": "NewName"}, headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert resp.json()["display_name"] == "NewName"
        # Persisted for the next login too.
        body = (await client.get("/api/reader/me", headers=_auth(token))).json()
        assert body["display_name"] == "NewName"

    async def test_email_is_immutable(self, client):
        token = (await _register(client)).json()["access_token"]
        resp = await client.patch(
            "/api/reader/me",
            json={"display_name": "X", "email": "hacked@example.com"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == "ss@example.com"

    async def test_display_name_validation(self, client):
        token = (await _register(client)).json()["access_token"]
        bad = await client.patch("/api/reader/me", json={"display_name": ""}, headers=_auth(token))
        assert bad.status_code == 422
        too_long = await client.patch("/api/reader/me", json={"display_name": "x" * 51}, headers=_auth(token))
        assert too_long.status_code == 422

    async def test_display_name_whitespace_only_rejected_422(self, client):
        """'   ' passed min_length=1 (Pydantic counts raw chars), then stored a
        display_name that rendered as a blank author name on comments/digests —
        strip at the boundary like every other name field (ISS-456)."""
        token = (await _register(client)).json()["access_token"]
        blank = await client.patch("/api/reader/me", json={"display_name": "   "}, headers=_auth(token))
        assert blank.status_code == 422, blank.text
        # Registration path is guarded too.
        reg = await client.post(
            "/api/reader/register",
            json={"email": "blank-dn@example.com", "password": "readerpass123", "display_name": "   "},
        )
        assert reg.status_code == 422, reg.text

    async def test_requires_token(self, client, db_session):
        await _post(db_session)
        resp = await client.patch("/api/reader/me", json={"display_name": "Nope"})
        assert resp.status_code == 401


class TestReaderPasswordChange:
    async def test_change_password_rotates_token_and_invalidates_old(self, client):
        token = (await _register(client)).json()["access_token"]

        resp = await client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "newpass456"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        fresh = resp.json()["access_token"]

        # New password works on login.
        login = await client.post("/api/reader/login", json={"email": "ss@example.com", "password": "newpass456"})
        assert login.status_code == 200

        # Old password is rejected.
        old = await client.post("/api/reader/login", json={"email": "ss@example.com", "password": "readerpass123"})
        assert old.status_code == 401

        # The pre-change token is revoked (token_version bump), the fresh one works.
        assert (await client.get("/api/reader/me", headers=_auth(token))).status_code == 401
        assert (await client.get("/api/reader/me", headers=_auth(fresh))).status_code == 200

    async def test_wrong_current_password_rejected(self, client):
        token = (await _register(client)).json()["access_token"]
        resp = await client.post(
            "/api/reader/me/password",
            json={"current_password": "wrongpass999", "new_password": "newpass456"},
            headers=_auth(token),
        )
        assert resp.status_code == 401, resp.text
        # Nothing changed — old token and password still work.
        assert (await client.get("/api/reader/me", headers=_auth(token))).status_code == 200

    async def test_new_password_validation(self, client):
        token = (await _register(client)).json()["access_token"]
        too_short = await client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "short"},
            headers=_auth(token),
        )
        assert too_short.status_code == 422
        too_long = await client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "x" * 73},
            headers=_auth(token),
        )
        assert too_long.status_code == 422

    async def test_requires_token(self, client):
        resp = await client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "newpass456"},
        )
        assert resp.status_code == 401


class TestPushSubscriptionManagement:
    async def test_list_own_subscriptions_sanitized(self, client, db_session):
        token = (await _register(client)).json()["access_token"]
        await _subscribe(client, headers=_auth(token), endpoint="https://fcm.example.com/dev1")
        await _subscribe(client, headers=_auth(token), endpoint="https://fcm.example.com/dev2")

        resp = await client.get("/api/reader/me/push-subscriptions", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        subs = body["items"]
        assert len(subs) == 2
        assert body["total"] == 2
        # No encryption keys leak back to the client.
        for s in subs:
            assert "p256dh" not in s and "auth" not in s

    async def test_subscriptions_isolated_per_reader(self, client, db_session):
        token_a = (await _register(client, email="a@example.com")).json()["access_token"]
        token_b = (await _register(client, email="b@example.com")).json()["access_token"]
        await _subscribe(client, headers=_auth(token_a), endpoint="https://fcm.example.com/aa")
        assert (await client.get("/api/reader/me/push-subscriptions", headers=_auth(token_a))).json()["total"] == 1
        assert (await client.get("/api/reader/me/push-subscriptions", headers=_auth(token_b))).json()["total"] == 0

    async def test_revoke_own_subscription(self, client, db_session):
        from app import models

        token = (await _register(client)).json()["access_token"]
        await _subscribe(client, headers=_auth(token), endpoint="https://fcm.example.com/dev")
        sub = (
            (
                await db_session.execute(
                    select(models.PushSubscription).where(
                        models.PushSubscription.endpoint == "https://fcm.example.com/dev"
                    )
                )
            )
            .scalars()
            .first()
        )
        assert sub is not None

        resp = await client.delete(f"/api/reader/me/push-subscriptions/{sub.id}", headers=_auth(token))
        assert resp.status_code == 204, resp.text
        assert (await client.get("/api/reader/me/push-subscriptions", headers=_auth(token))).json()["total"] == 0

    async def test_cannot_revoke_another_reader_subscription(self, client, db_session):
        from app import models

        token_a = (await _register(client, email="a@example.com")).json()["access_token"]
        token_b = (await _register(client, email="b@example.com")).json()["access_token"]
        await _subscribe(client, headers=_auth(token_a), endpoint="https://fcm.example.com/other")
        sub = (
            (
                await db_session.execute(
                    select(models.PushSubscription).where(
                        models.PushSubscription.endpoint == "https://fcm.example.com/other"
                    )
                )
            )
            .scalars()
            .first()
        )
        resp = await client.delete(f"/api/reader/me/push-subscriptions/{sub.id}", headers=_auth(token_b))
        assert resp.status_code == 404, resp.text
        # A's subscription is untouched.
        assert (await client.get("/api/reader/me/push-subscriptions", headers=_auth(token_a))).json()["total"] == 1

    async def test_requires_token(self, client):
        assert (await client.get("/api/reader/me/push-subscriptions")).status_code == 401
        assert (await client.delete("/api/reader/me/push-subscriptions/1")).status_code == 401

    async def test_revoke_huge_subscription_id_is_422(self, client, db_session):
        # >bigint subscription id is rejected at the boundary (IdInt) with a
        # clean 422 on every backend, not a Postgres-only bigint-overflow 500
        # (backend deep-dive, ISS-448).
        token = (await _register(client, email="bigid@example.com")).json()["access_token"]
        resp = await client.delete(
            "/api/reader/me/push-subscriptions/99999999999999999999999999",
            headers=_auth(token),
        )
        assert resp.status_code == 422
