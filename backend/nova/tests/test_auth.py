from pathlib import Path

import jwt

from app.auth import (
    SECRET_KEY,
    TokenData,
    create_access_token,
    get_password_hash,
    verify_password,
)


class TestAuth:
    def test_verify_password_correct(self):
        hashed = get_password_hash("testpass123")
        assert verify_password("testpass123", hashed) is True

    def test_verify_password_wrong(self):
        hashed = get_password_hash("testpass123")
        assert verify_password("wrongpass", hashed) is False

    def test_get_password_hash(self):
        password = "testpassword"
        hashed = get_password_hash(password)
        assert hashed != password
        assert len(hashed) > 0

    def test_create_access_token(self):
        token = create_access_token({"sub": 1})
        assert token is not None
        assert isinstance(token, str)

        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        assert payload["sub"] == "1"

    def test_token_data(self):
        data = TokenData(user_id=1)
        assert data.user_id == 1


class TestTokenExpiry:
    """Session-expiry knobs (RIL ISS-273).

    Admin JWTs carry an ``exp`` claim defaulting to 1 day (JWT_EXPIRE_DAYS). An
    operator who wants a shorter session, e.g. 30 minutes, must be able to
    express it — whole days cannot, so JWT_EXPIRE_MINUTES takes precedence."""

    def test_default_expire_days_is_one(self, monkeypatch):
        monkeypatch.delenv("JWT_EXPIRE_MINUTES", raising=False)
        monkeypatch.delenv("JWT_EXPIRE_DAYS", raising=False)
        from app import auth as auth_mod

        assert auth_mod.admin_token_expire_days() == 1

    def test_expire_minutes_overrides_days(self, monkeypatch):
        monkeypatch.setenv("JWT_EXPIRE_MINUTES", "30")
        monkeypatch.setenv("JWT_EXPIRE_DAYS", "365")  # day knob must lose
        from app import auth as auth_mod

        days = auth_mod.admin_token_expire_days()
        assert days == 30 / (24 * 60)

    def test_jwt_exp_reflects_minutes_override(self, monkeypatch):
        from datetime import UTC, datetime, timedelta

        monkeypatch.setenv("JWT_EXPIRE_MINUTES", "30")
        token = create_access_token({"sub": 9})
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        exp = datetime.fromtimestamp(payload["exp"], tz=UTC)
        assert abs((exp - datetime.now(UTC)) - timedelta(minutes=30)) < timedelta(seconds=60)


class TestAuthEdgeCases:
    def test_verify_password_empty(self):
        hashed = get_password_hash("")
        assert verify_password("", hashed) is True

    def test_create_access_token_empty_sub(self):
        token = create_access_token({})
        assert token is not None


class TestFailClosedSecret:
    """Importing app.auth without JWT_SECRET_KEY must fail closed outside development."""

    def test_import_fails_closed_without_secret(self):
        """Importing app.auth with no JWT_SECRET_KEY and no APP_ENV raises RuntimeError."""
        import subprocess
        import sys

        code = "import os;os.environ.pop('JWT_SECRET_KEY', None);os.environ.pop('APP_ENV', None);import app.auth"
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parent.parent,
        )
        assert result.returncode != 0
        assert "JWT_SECRET_KEY" in result.stderr

    def test_import_fails_closed_in_production(self):
        """Importing app.auth with APP_ENV=production and no secret raises RuntimeError."""
        import subprocess
        import sys

        code = "import os;os.environ.pop('JWT_SECRET_KEY', None);os.environ['APP_ENV'] = 'production';import app.auth"
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parent.parent,
        )
        assert result.returncode != 0
        assert "JWT_SECRET_KEY" in result.stderr

    def test_import_allowed_in_development(self):
        """Importing app.auth without a secret succeeds when APP_ENV=development."""
        import subprocess
        import sys

        code = (
            "import os;"
            "os.environ.pop('JWT_SECRET_KEY', None);"
            "os.environ['APP_ENV'] = 'development';"
            "import app.auth;"
            "print(app.auth.SECRET_KEY)"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parent.parent,
        )
        assert result.returncode == 0, result.stderr
        assert "x-blog-secret-key-dev-only" in result.stdout
