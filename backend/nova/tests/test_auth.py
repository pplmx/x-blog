from pathlib import Path

from jose import jwt

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
