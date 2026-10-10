"""Reader TOTP two-factor authentication contract tests (round 364, DEC-401).

Reader accounts now guard durable private data (cloud-synced bookmarks/likes/
history, GDPR export), so a single leaked email+password is the only thing
standing between an attacker and all of it. A reader can enable TOTP 2FA
(RFC 6238, any authenticator app) from /account: /me/2fa/setup returns a
fresh base32 secret + otpauth URI, /me/2fa/enable proves possession with one
6-digit code and flips the flag, and /me/2fa/disable (current password AND a
valid code) turns it back off. With the flag on, POST /login deliberately
returns NO access_token — only a short-lived, single-purpose `mfa_token`
(aud=x-blog-reader-2fa, ver-tied, 5-min expiry) that unlocks POST /login/2fa,
where the correct code is exchanged for the real session. Wrong codes, bogus
mfa tokens, and replayed pre-password-change tokens are all rejected; the
secret is never serialized into any profile or token response.
"""

import pyotp

LOGIN = "/api/reader/login"
LOGIN_2FA = "/api/reader/login/2fa"
ME = "/api/reader/me"
SETUP = "/api/reader/me/2fa/setup"
ENABLE = "/api/reader/me/2fa/enable"
DISABLE = "/api/reader/me/2fa/disable"
PASSWORD = "/api/reader/me/password"

_EMAIL_COUNTER = 0


async def _register(client, email=None, password="readerpass123"):
    """Register a fresh reader; returns the parsed login JSON."""
    global _EMAIL_COUNTER
    _EMAIL_COUNTER += 1
    email = email or f"mfa-{_EMAIL_COUNTER}@example.com"
    resp = await client.post("/api/reader/register", json={"email": email, "password": password})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _reader(client, email=None, password="readerpass123"):
    """Register one reader and return (access_token, reader_id)."""
    reg = await _register(client, email=email, password=password)
    return reg["access_token"], reg["reader"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _setup(client, token):
    """Run the setup step; returns the parsed {secret, otpauth_uri}."""
    resp = await client.post(SETUP, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _enable(client, token, secret, code=None, password="readerpass123"):
    """Enable 2FA with the current password + a code (defaults to the CURRENT
    valid code for `secret`). Enrollment requires the password too — a stolen
    session alone must not be able to register a factor (security review,
    DEC-401)."""
    if code is None:
        code = pyotp.TOTP(secret).now()
    return await client.post(ENABLE, json={"current_password": password, "code": code}, headers=_auth(token))


async def _enable_ok(client, token, secret):
    resp = await _enable(client, token, secret)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _login(client, email, password="readerpass123"):
    return await client.post(LOGIN, json={"email": email, "password": password})


class TestSetupAndEnable:
    async def test_setup_returns_a_secret_and_provisioning_uri(self, client):
        token, _ = await _reader(client)
        body = await _setup(client, token)
        assert len(body["secret"]) >= 16  # base32 seed
        assert body["otpauth_uri"].startswith("otpauth://totp/")
        assert body["secret"] in body["otpauth_uri"]  # the URI encodes the seed
        assert "issuer=X-Blog" in body["otpauth_uri"]

    async def test_setup_does_not_enable_2fa(self, client):
        token, _ = await _reader(client)
        await _setup(client, token)
        assert ((await client.get(ME, headers=_auth(token))).json())["two_factor_enabled"] is False

    async def test_repeated_setup_regenerates_a_valid_secret(self, client):
        token, _ = await _reader(client)
        await _setup(client, token)  # first enrollment is simply discarded
        second = await _setup(client, token)
        assert set(second) == {"secret", "otpauth_uri"}
        assert pyotp.TOTP(second["secret"]).now()  # a usable seed

    async def test_enable_rejects_a_wrong_code(self, client):
        token, _ = await _reader(client)
        secret = (await _setup(client, token))["secret"]
        resp = await _enable(client, token, secret, code="000000")
        assert resp.status_code == 400
        # Still off — and a login stays single-step.
        assert ((await client.get(ME, headers=_auth(token))).json())["two_factor_enabled"] is False

    async def test_enable_rejects_without_the_current_password(self, client):
        # A valid code is NOT enough: a stolen session must not be able to
        # enroll its own authenticator and lock the owner out.
        token, _ = await _reader(client)
        secret = (await _setup(client, token))["secret"]
        resp = await _enable(client, token, secret, code="000000", password="wrongpass1")
        assert resp.status_code == 400
        resp = await _enable(client, token, secret, password="wrongpass1")  # right code
        assert resp.status_code == 400
        assert ((await client.get(ME, headers=_auth(token))).json())["two_factor_enabled"] is False

    async def test_enable_with_a_valid_code_turns_2fa_on(self, client):
        token, _ = await _reader(client)
        secret = (await _setup(client, token))["secret"]
        await _enable_ok(client, token, secret)
        assert ((await client.get(ME, headers=_auth(token))).json())["two_factor_enabled"] is True

    async def test_setup_after_enabled_is_rejected(self, client):
        token, _ = await _reader(client)
        secret = (await _setup(client, token))["secret"]
        await _enable_ok(client, token, secret)
        resp = await client.post(SETUP, headers=_auth(token))
        assert resp.status_code == 409


# The 2FA login-carve-out tests share one enrolled reader so they can be read
# as a sequence; each test still re-registers it (every test starts from a
# rolled-back DB) under a per-test unique email.
ENROLLED_EMAIL = "mfa-enrolled@example.com"


async def _enrolled_reader(client, email=ENROLLED_EMAIL, password="readerpass123"):
    """Register, set up, and ENABLE 2FA; returns (token, secret, email)."""
    token, _ = await _reader(client, email=email, password=password)
    secret = (await _setup(client, token))["secret"]
    await _enable_ok(client, token, secret)
    return token, secret, email


class TestLoginRequiresSecondStep:
    async def test_login_with_2fa_returns_mfa_token_and_no_access_token(self, client):
        await _enrolled_reader(client)
        resp = await _login(client, ENROLLED_EMAIL)
        assert resp.status_code == 200
        body = resp.json()
        assert body["two_factor_required"] is True
        assert not body["access_token"]
        assert body["mfa_token"]
        assert body["reader"] is None

    async def test_login_without_2fa_is_unchanged(self, client):
        _, reader_id = await _reader(client, email="mfa-plain@example.com")
        assert reader_id  # just proving a reader was made
        resp = await _login(client, "mfa-plain@example.com")
        assert resp.status_code == 200
        body = resp.json()
        assert body["two_factor_required"] is False
        assert body["access_token"]
        assert body["reader"]

    async def test_second_step_rejects_a_wrong_code(self, client):
        await _enrolled_reader(client)
        mfa = (await _login(client, ENROLLED_EMAIL)).json()["mfa_token"]
        resp = await client.post(LOGIN_2FA, json={"mfa_token": mfa, "code": "000000"})
        assert resp.status_code == 401

    async def test_second_step_with_the_right_code_issues_a_session(self, client):
        _, secret, _ = await _enrolled_reader(client)
        mfa = (await _login(client, ENROLLED_EMAIL)).json()["mfa_token"]
        resp = await client.post(LOGIN_2FA, json={"mfa_token": mfa, "code": pyotp.TOTP(secret).now()})
        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"]
        assert body["two_factor_required"] is False
        # The issued token is a real reader session for the enrolled reader.
        me = await client.get(ME, headers=_auth(body["access_token"]))
        assert me.status_code == 200
        assert me.json()["email"] == ENROLLED_EMAIL

    async def test_second_step_rejects_a_bogus_mfa_token(self, client):
        resp = await client.post(LOGIN_2FA, json={"mfa_token": "not-a-jwt", "code": "123456"})
        assert resp.status_code == 401

    async def test_an_mfa_token_dies_when_the_password_changes(self, client):
        token, secret, _ = await _enrolled_reader(client, email="mfa-passchange@example.com")
        mfa = (await _login(client, "mfa-passchange@example.com")).json()["mfa_token"]
        # Bump token_version via a password change (also invalidates old JWTs).
        resp = await client.post(
            PASSWORD,
            json={"current_password": "readerpass123", "new_password": "newpass456"},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        # The pre-change mfa_token can no longer open the second step — even
        # with a correct code, because the `ver` claim no longer matches the
        # account's current token_version.
        resp = await client.post(
            LOGIN_2FA,
            json={"mfa_token": mfa, "code": pyotp.TOTP(secret).now()},
        )
        assert resp.status_code == 401

    async def test_an_mfa_token_is_not_a_reader_credential(self, client):
        await _enrolled_reader(client)
        mfa = (await _login(client, ENROLLED_EMAIL)).json()["mfa_token"]
        me = await client.get(ME, headers=_auth(mfa))
        assert me.status_code == 401


class TestDisable:
    async def test_disable_requires_password_and_code(self, client):
        token, secret, _ = await _enrolled_reader(client)
        # Wrong password is rejected even with a correct code.
        bad_pass = await client.post(
            DISABLE,
            json={"current_password": "wrongpass1", "code": pyotp.TOTP(secret).now()},
            headers=_auth(token),
        )
        assert bad_pass.status_code == 400
        # Right password but wrong code is rejected too.
        bad_code = await client.post(
            DISABLE,
            json={"current_password": "readerpass123", "code": "000000"},
            headers=_auth(token),
        )
        assert bad_code.status_code == 400
        # Both right → off, secret cleared, login back to single-step.
        ok = await client.post(
            DISABLE,
            json={"current_password": "readerpass123", "code": pyotp.TOTP(secret).now()},
            headers=_auth(token),
        )
        assert ok.status_code == 200
        assert ((await client.get(ME, headers=_auth(token))).json())["two_factor_enabled"] is False
        body = (await _login(client, ENROLLED_EMAIL)).json()
        assert body["two_factor_required"] is False
        assert body["access_token"]


class TestNoSecretLeak:
    async def test_the_secret_never_rides_profiles_or_login_responses(self, client):
        token, reader_id = await _reader(client, email="mfa-leak@example.com")
        secret = (await _setup(client, token))["secret"]
        await _enable_ok(client, token, secret)
        # /me profile (reader-owned envelope) exposes only the enabled FLAG.
        me = (await client.get(ME, headers=_auth(token))).json()
        assert me["two_factor_enabled"] is True
        assert "two_factor_secret" not in me
        # The public profile (unauthenticated) carries neither.
        public = (await client.get(f"/api/readers/{reader_id}")).json()["profile"]
        assert "two_factor_enabled" not in public
        assert "two_factor_secret" not in public
        # The 2FA challenge login response carries only the challenge token.
        challenge = (await _login(client, "mfa-leak@example.com")).json()
        assert secret not in str(challenge)
