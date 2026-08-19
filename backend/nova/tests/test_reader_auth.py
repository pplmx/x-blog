"""Reader account auth contract tests (DEC-059, TASK-131).

Reader accounts are the identity layer for cloud-synced bookmarks (and future
reader features). The critical property beyond happy-path register/login is
*audience separation*: a reader JWT must never authenticate as an admin, even
if ``sub`` (the reader_account.id) collides with a users.id — otherwise a
bookmark-syncing JS client holding a reader token could mint admin requests.
"""

import jwt as pyjwt

from app.auth import ALGORITHM, READER_AUDIENCE, SECRET_KEY, create_reader_token

REGISTER = "/api/reader/register"
LOGIN = "/api/reader/login"
ME = "/api/reader/me"


def _register(client, email="reader@example.com", password="readerpass123", **extra):
    body = {"email": email, "password": password, **extra}
    return client.post(REGISTER, json=body)


class TestRegister:
    def test_register_returns_token_and_profile(self, client):
        resp = _register(client)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["access_token"]
        assert data["token_type"] == "bearer"
        assert data["reader"]["email"] == "reader@example.com"
        assert data["reader"]["id"] > 0
        # freshly-registered account has no display name unless provided
        assert data["reader"]["display_name"] is None
        assert "password" not in data["reader"]

    def test_register_with_display_name(self, client):
        resp = _register(client, display_name="Riki")
        assert resp.status_code == 201, resp.text
        assert resp.json()["reader"]["display_name"] == "Riki"

    def test_register_duplicate_email_rejected(self, client):
        assert _register(client).status_code == 201
        resp = _register(client)  # same email
        assert resp.status_code == 400
        assert "already" in resp.json()["error"]["message"].lower()

    def test_register_email_is_case_insensitive_unique(self, client):
        """Email is normalized to lowercase: a differently-cased variant of an
        existing email must be rejected (not a second account), keeping login
        (which compares lowercased) unambiguous."""
        assert _register(client).status_code == 201
        resp = _register(client, email="Reader@Example.COM")
        assert resp.status_code == 400
        assert "already" in resp.json()["error"]["message"].lower()

    def test_register_normalizes_email_case_for_login(self, client):
        resp = _register(client, email="Reader@Example.com")
        assert resp.status_code == 201, resp.text
        # login is case-insensitive; profile echoes the normalized form
        login = client.post(LOGIN, json={"email": "reader@example.com", "password": "readerpass123"})
        assert login.status_code == 200, login.text
        assert login.json()["reader"]["email"] == "reader@example.com"

    def test_register_invalid_email_rejected(self, client):
        resp = _register(client, email="not-an-email")
        assert resp.status_code == 422

    def test_register_short_password_rejected(self, client):
        resp = _register(client, password="short")
        assert resp.status_code == 422

    def test_register_trailing_newline_email_rejected(self, client):
        """A trailing newline after the email must not sneak past the regex
        anchor (uses Rust-regex \\z, not $)."""
        resp = _register(client, email="reader@example.com\n")
        assert resp.status_code == 422


class TestLogin:
    def test_login_returns_token(self, client):
        _register(client)
        resp = client.post(LOGIN, json={"email": "reader@example.com", "password": "readerpass123"})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["access_token"]
        assert data["reader"]["email"] == "reader@example.com"

    def test_login_wrong_password_rejected(self, client):
        _register(client)
        resp = client.post(LOGIN, json={"email": "reader@example.com", "password": "wrongpass123"})
        assert resp.status_code == 401

    def test_login_unknown_email_rejected(self, client):
        resp = client.post(LOGIN, json={"email": "nobody@example.com", "password": "readerpass123"})
        assert resp.status_code == 401

    def test_login_unknown_email_still_runs_bcrypt(self, client, monkeypatch):
        """Timing guard: unknown emails must not short-circuit before bcrypt,
        or response timing would leak whether an email exists."""
        from app.routers import reader as reader_module

        calls: list[tuple[str, str]] = []

        def spy(plain: str, hashed: str) -> bool:
            calls.append((plain, hashed))
            return True

        monkeypatch.setattr(reader_module.auth, "verify_password", spy)
        resp = client.post(LOGIN, json={"email": "nobody@example.com", "password": "readerpass123"})
        assert resp.status_code == 401
        # bcrypt was called with the fake dummy hash, not skipped entirely
        assert len(calls) == 1
        assert calls[0][1] == reader_module._FAKE_BCRYPT_HASH


class TestMe:
    def test_me_with_valid_token(self, client):
        reg = _register(client)
        token = reg.json()["access_token"]
        resp = client.get(ME, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["email"] == "reader@example.com"

    def test_me_without_token_rejected(self, client):
        resp = client.get(ME)
        assert resp.status_code == 401
        # FastAPI's OAuth2PasswordBearer raises "Not authenticated" when no
        # Authorization header is present at all (distinct from an invalid
        # token, which reaches our own "Could not validate credentials").
        assert resp.json()["error"]["code"] == "UNAUTHORIZED"

    def test_me_with_garbage_token_rejected(self, client):
        resp = client.get(ME, headers={"Authorization": "Bearer not.a.jwt"})
        assert resp.status_code == 401

    def test_me_with_admin_token_rejected(self, client, admin_token):
        """An admin JWT must not authenticate as a reader (audience separation)."""
        resp = client.get(ME, headers={"Authorization": f"Bearer {admin_token}"})
        assert resp.status_code == 401


class TestAudienceSeparation:
    """Reader/admin tokens must be mutually exclusive credentials.

    The critical attack this blocks: ``get_current_user`` (admin guard) used to
    accept any token whose ``sub``/``ver`` matched a users row. A reader token
    whose ``sub`` equals an admin users.id would otherwise authenticate as that
    admin. Reader tokens carry ``aud=x-blog-reader`` and the admin guard must
    reject them outright.
    """

    def test_reader_token_rejected_by_admin_endpoint(self, client, admin_user):
        reg = _register(client)
        reader_token = reg.json()["access_token"]

        # Force the collision scenario: reader_account.id == admin users.id.
        # admin_user fixture flushes (id assigned); reader got id=1 in a fresh
        # DB too, making the sub collision real in this test DB.
        resp = client.get("/api/admin/me", headers={"Authorization": f"Bearer {reader_token}"})
        assert resp.status_code in (401, 403)
        # Never expose the admin profile through a reader token.
        assert "username" not in resp.json()

    def test_admin_token_cannot_be_forged_as_reader_with_same_sub(self, client):
        """A reader-created token with an admin sub is rejected by the reader guard."""
        token = create_reader_token({"sub": 1, "ver": 0})
        resp = client.get(ME, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    def test_list_form_reader_aud_rejected_by_admin_endpoint(self, client, admin_user):
        """Defense-in-depth (security review L3): even a list-form aud claim
        (["x-blog-reader", ...]) must never authenticate as an admin."""
        token = pyjwt.encode(
            {"sub": "1", "aud": [READER_AUDIENCE, "admin"], "exp": 9999999999},
            SECRET_KEY,
            algorithm=ALGORITHM,
        )
        resp = client.get("/api/admin/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code in (401, 403)
        assert "username" not in resp.json()

    def test_reader_token_has_reader_aud_claim(self, client):
        payload = pyjwt.decode(
            _register(client).json()["access_token"],
            SECRET_KEY,
            algorithms=[ALGORITHM],
            audience="x-blog-reader",
        )
        assert payload.get("aud") == "x-blog-reader"
        assert payload.get("sub") is not None


class TestTokenRevocation:
    def test_old_token_rejected_after_password_change(self, client, db_session):
        reg = _register(client)
        token = reg.json()["access_token"]
        reader_id = reg.json()["reader"]["id"]

        # Simulate credential rotation: bump token_version (as a password
        # change would) and confirm the previously-issued token is dead.
        from app.auth import ReaderAccount

        reader = db_session.get(ReaderAccount, reader_id)
        reader.token_version = (reader.token_version or 0) + 1
        db_session.commit()

        resp = client.get(ME, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401
