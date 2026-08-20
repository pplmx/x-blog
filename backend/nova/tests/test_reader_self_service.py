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

from app.schemas import PostCreate


def _post(db_session, slug="self-service-post"):
    from app.crud import create_post

    return create_post(db_session, PostCreate(title="SS", slug=slug, content="# Hi", published=True))


def _register(client, email="ss@example.com", display_name="Orig"):
    return client.post(
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


def _subscribe(client, headers, endpoint="https://fcm.example.com/self"):
    return client.post(
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
    def test_update_display_name(self, client, db_session):
        token = _register(client, display_name="Old").json()["access_token"]
        resp = client.patch("/api/reader/me", json={"display_name": "NewName"}, headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert resp.json()["display_name"] == "NewName"
        # Persisted for the next login too.
        body = client.get("/api/reader/me", headers=_auth(token)).json()
        assert body["display_name"] == "NewName"

    def test_email_is_immutable(self, client):
        token = _register(client).json()["access_token"]
        resp = client.patch(
            "/api/reader/me",
            json={"display_name": "X", "email": "hacked@example.com"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == "ss@example.com"

    def test_display_name_validation(self, client):
        token = _register(client).json()["access_token"]
        bad = client.patch("/api/reader/me", json={"display_name": ""}, headers=_auth(token))
        assert bad.status_code == 422
        too_long = client.patch("/api/reader/me", json={"display_name": "x" * 51}, headers=_auth(token))
        assert too_long.status_code == 422

    def test_requires_token(self, client, db_session):
        _post(db_session)
        resp = client.patch("/api/reader/me", json={"display_name": "Nope"})
        assert resp.status_code == 401


class TestReaderPasswordChange:
    def test_change_password_rotates_token_and_invalidates_old(self, client):
        token = _register(client).json()["access_token"]

        resp = client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "newpass456"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        fresh = resp.json()["access_token"]

        # New password works on login.
        login = client.post(
            "/api/reader/login", json={"email": "ss@example.com", "password": "newpass456"}
        )
        assert login.status_code == 200

        # Old password is rejected.
        old = client.post(
            "/api/reader/login", json={"email": "ss@example.com", "password": "readerpass123"}
        )
        assert old.status_code == 401

        # The pre-change token is revoked (token_version bump), the fresh one works.
        assert client.get("/api/reader/me", headers=_auth(token)).status_code == 401
        assert client.get("/api/reader/me", headers=_auth(fresh)).status_code == 200

    def test_wrong_current_password_rejected(self, client):
        token = _register(client).json()["access_token"]
        resp = client.post(
            "/api/reader/me/password",
            json={"current_password": "wrongpass999", "new_password": "newpass456"},
            headers=_auth(token),
        )
        assert resp.status_code == 401, resp.text
        # Nothing changed — old token and password still work.
        assert client.get("/api/reader/me", headers=_auth(token)).status_code == 200

    def test_new_password_validation(self, client):
        token = _register(client).json()["access_token"]
        too_short = client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "short"},
            headers=_auth(token),
        )
        assert too_short.status_code == 422
        too_long = client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "x" * 73},
            headers=_auth(token),
        )
        assert too_long.status_code == 422

    def test_requires_token(self, client):
        resp = client.post(
            "/api/reader/me/password",
            json={"current_password": "readerpass123", "new_password": "newpass456"},
        )
        assert resp.status_code == 401


class TestPushSubscriptionManagement:
    def test_list_own_subscriptions_sanitized(self, client, db_session):
        token = _register(client).json()["access_token"]
        _subscribe(client, headers=_auth(token), endpoint="https://fcm.example.com/dev1")
        _subscribe(client, headers=_auth(token), endpoint="https://fcm.example.com/dev2")

        resp = client.get("/api/reader/me/push-subscriptions", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        subs = body["items"]
        assert len(subs) == 2
        assert body["total"] == 2
        # No encryption keys leak back to the client.
        for s in subs:
            assert "p256dh" not in s and "auth" not in s

    def test_subscriptions_isolated_per_reader(self, client, db_session):
        token_a = _register(client, email="a@example.com").json()["access_token"]
        token_b = _register(client, email="b@example.com").json()["access_token"]
        _subscribe(client, headers=_auth(token_a), endpoint="https://fcm.example.com/aa")
        assert client.get("/api/reader/me/push-subscriptions", headers=_auth(token_a)).json()["total"] == 1
        assert client.get("/api/reader/me/push-subscriptions", headers=_auth(token_b)).json()["total"] == 0

    def test_revoke_own_subscription(self, client, db_session):
        from app import models

        token = _register(client).json()["access_token"]
        _subscribe(client, headers=_auth(token), endpoint="https://fcm.example.com/dev")
        sub = (
            db_session.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == "https://fcm.example.com/dev")
            .first()
        )
        assert sub is not None

        resp = client.delete(
            f"/api/reader/me/push-subscriptions/{sub.id}", headers=_auth(token)
        )
        assert resp.status_code == 204, resp.text
        assert client.get("/api/reader/me/push-subscriptions", headers=_auth(token)).json()["total"] == 0

    def test_cannot_revoke_another_reader_subscription(self, client, db_session):
        from app import models

        token_a = _register(client, email="a@example.com").json()["access_token"]
        token_b = _register(client, email="b@example.com").json()["access_token"]
        _subscribe(client, headers=_auth(token_a), endpoint="https://fcm.example.com/other")
        sub = (
            db_session.query(models.PushSubscription)
            .filter(models.PushSubscription.endpoint == "https://fcm.example.com/other")
            .first()
        )
        resp = client.delete(f"/api/reader/me/push-subscriptions/{sub.id}", headers=_auth(token_b))
        assert resp.status_code == 404, resp.text
        # A's subscription is untouched.
        assert client.get("/api/reader/me/push-subscriptions", headers=_auth(token_a)).json()["total"] == 1

    def test_requires_token(self, client):
        assert client.get("/api/reader/me/push-subscriptions").status_code == 401
        assert client.delete("/api/reader/me/push-subscriptions/1").status_code == 401
