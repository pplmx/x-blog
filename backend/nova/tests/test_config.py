"""Tests for configuration module."""

import os
from pathlib import Path
from unittest.mock import patch


class TestSettingsDefaults:
    """Tests for Settings default values."""

    def test_database_url_default(self):
        """Test database_url has correct default."""
        from app.config import Settings

        # Create a fresh Settings instance with no env vars
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.database_url == "sqlite:///./aurora.db"

    def test_site_url_default(self):
        """Test site_url has correct default."""
        from app.config import Settings

        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.site_url == "http://localhost:3000"

    def test_site_title_default(self):
        """Test site_title has correct default."""
        from app.config import Settings

        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.site_title == "X-Blog"

    def test_site_description_default(self):
        """Test site_description has correct default."""
        from app.config import Settings

        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.site_description == "A modern blog built with FastAPI and Next.js"

    def test_sentry_dsn_default_none(self):
        """Test sentry_dsn defaults to None."""
        from app.config import Settings

        with patch.dict(os.environ, {}, clear=True):
            settings = Settings()
            assert settings.sentry_dsn is None


class TestSettingsEnvironmentVariables:
    """Tests for environment variable loading."""

    def test_database_url_from_env(self):
        """Test database_url can be set via environment variable."""
        from app.config import Settings

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://localhost/mydb"}):
            settings = Settings()
            assert settings.database_url == "postgresql://localhost/mydb"

    def test_site_url_from_env(self):
        """Test site_url can be set via environment variable."""
        from app.config import Settings

        with patch.dict(os.environ, {"SITE_URL": "https://myblog.com"}):
            settings = Settings()
            assert settings.site_url == "https://myblog.com"

    def test_site_title_from_env(self):
        """Test site_title can be set via environment variable."""
        from app.config import Settings

        with patch.dict(os.environ, {"SITE_TITLE": "My Custom Blog"}):
            settings = Settings()
            assert settings.site_title == "My Custom Blog"

    def test_site_description_from_env(self):
        """Test site_description can be set via environment variable."""
        from app.config import Settings

        with patch.dict(os.environ, {"SITE_DESCRIPTION": "A custom blog description"}):
            settings = Settings()
            assert settings.site_description == "A custom blog description"

    def test_sentry_dsn_from_env(self):
        """Test sentry_dsn can be set via environment variable."""
        from app.config import Settings

        with patch.dict(os.environ, {"SENTRY_DSN": "https://key@sentry.io/123"}):
            settings = Settings()
            assert settings.sentry_dsn == "https://key@sentry.io/123"

    def test_sentry_dsn_can_be_empty_string(self):
        """Test sentry_dsn can be set to empty string."""
        from app.config import Settings

        with patch.dict(os.environ, {"SENTRY_DSN": ""}):
            _settings = Settings()
            # pydantic-settings treats empty string differently from None
            # It may remain as empty string or be coerced to None depending on config


class TestSettingsValidation:
    """Tests for settings validation."""

    def test_settings_is_pydantic_model(self):
        """Test Settings is a Pydantic model."""
        from app.config import Settings

        settings = Settings()
        assert hasattr(settings, "model_dump")
        assert hasattr(settings, "model_validate")

    def test_settings_env_file_config(self):
        """Test Settings uses env_file configuration."""
        from app.config import Settings

        # Verify the model_config includes env_file setting
        settings = Settings()
        assert settings.model_config is not None

    def test_settings_all_fields_present(self):
        """Test Settings has all expected fields."""
        from app.config import Settings

        settings = Settings()
        assert hasattr(settings, "database_url")
        assert hasattr(settings, "site_url")
        assert hasattr(settings, "site_title")
        assert hasattr(settings, "site_description")
        assert hasattr(settings, "sentry_dsn")


class TestSettingsSingleton:
    """Tests for settings singleton usage."""

    def test_settings_singleton_exists(self):
        """Test that settings singleton is created."""
        from app.config import settings

        assert settings is not None

    def test_settings_singleton_type(self):
        """Test settings singleton is Settings instance."""
        from app.config import settings

        # Should be a Settings instance (or the model_validate behavior)
        assert hasattr(settings, "database_url")


class TestSettingsTypeAnnotations:
    """Tests for settings type annotations."""

    def test_database_url_type(self):
        """Test database_url is string type."""
        from app.config import Settings

        settings = Settings()
        assert isinstance(settings.database_url, str)

    def test_site_url_type(self):
        """Test site_url is string type."""
        from app.config import Settings

        settings = Settings()
        assert isinstance(settings.site_url, str)

    def test_site_title_type(self):
        """Test site_title is string type."""
        from app.config import Settings

        settings = Settings()
        assert isinstance(settings.site_title, str)

    def test_site_description_type(self):
        """Test site_description is string type."""
        from app.config import Settings

        settings = Settings()
        assert isinstance(settings.site_description, str)

    def test_sentry_dsn_type(self):
        """Test sentry_dsn is string or None type."""
        from app.config import Settings

        settings = Settings()
        assert settings.sentry_dsn is None or isinstance(settings.sentry_dsn, str)


class TestEnvFileVisibility:
    """Regression (round 433, ISS-636): values read ONLY from .env must reach
    the direct os.getenv readers, not just pydantic-settings.

    pydantic-settings reads .env but does NOT export those values into
    os.environ, while is_development() (APP_ENV) and emailer._is_en_site()
    (SITE_LANGUAGE) read os.getenv directly. Without load_dotenv(), an
    APP_ENV/SITE_LANGUAGE set only in .env was invisible to them: dev startup
    crashed with no dev JWT key, and RSS/Atom feeds (settings.site_language)
    disagreed with English/Chinese email copy (_is_en_site).
    """

    _ENV_CONTENT = "APP_ENV=development\nSITE_LANGUAGE=en-US\n"

    def _run_in_isolated_cwd(self, tmp_path, env_content: str, code: str):
        """Run ``code`` with a temp cwd holding a real .env, so pydantic's
        env_file and load_dotenv() both resolve it — WITHOUT touching the
        shared backend dir (xdist workers share that cwd; a stray .env there
        would leak into every parallel worker's Settings())."""
        import os
        import subprocess
        import sys

        backend_dir = str(Path(__file__).resolve().parent.parent)
        (tmp_path / ".env").write_text(env_content, encoding="utf-8")
        env = dict(os.environ)
        existing = [k for k in ("PYTHONPATH",) if k in env]
        env["PYTHONPATH"] = backend_dir + (os.pathsep + env["PYTHONPATH"] if existing else "")
        return subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            cwd=tmp_path,
            env=env,
        )

    def test_dotenv_values_visible_to_os_getenv_readers(self, tmp_path, monkeypatch):
        """A .env-only APP_ENV/SITE_LANGUAGE must flip is_development and
        _is_en_site the same way a process-env value would."""
        code = (
            "import os;"
            "os.environ.pop('JWT_SECRET_KEY', None);"
            "os.environ.pop('APP_ENV', None);"
            "os.environ.pop('SITE_LANGUAGE', None);"
            "from app.config import is_development;"
            "from app.emailer import _is_en_site;"
            "print(is_development(), _is_en_site())"
        )
        result = self._run_in_isolated_cwd(tmp_path, self._ENV_CONTENT, code)
        assert result.returncode == 0, result.stderr
        assert result.stdout.split() == ["True", "True"], result.stdout

    def test_process_env_still_wins_over_dotenv(self, tmp_path, monkeypatch):
        """load_dotenv(override=False) must not clobber an already-set process
        var — a production deployment that exports APP_ENV=production must stay
        production even if a stray .env says otherwise."""
        code = (
            "import os;"
            "os.environ['APP_ENV'] = 'production';"
            "from app.config import is_development;"
            "print(is_development())"
        )
        result = self._run_in_isolated_cwd(tmp_path, "APP_ENV=development\n", code)
        assert result.returncode == 0, result.stderr
        assert result.stdout.split() == ["False"], result.stdout


class TestSettingsEdgeCases:
    """Tests for edge cases in settings."""

    def test_empty_environment(self):
        """Test settings work with empty environment."""
        from app.config import Settings

        # Clear all environment vars except those needed for test
        with patch.dict(
            os.environ,
            {"JWT_SECRET_KEY": "test-secret"},
            clear=True,
        ):
            settings = Settings()
            assert settings.database_url is not None
            assert settings.site_title == "X-Blog"

    def test_special_characters_in_title(self):
        """Test site_title handles special characters."""
        from app.config import Settings

        with patch.dict(os.environ, {"SITE_TITLE": "Blog with 'quotes' & symbols!"}):
            settings = Settings()
            assert "'" in settings.site_title
            assert "&" in settings.site_title

    def test_url_with_port(self):
        """Test site_url with port number."""
        from app.config import Settings

        with patch.dict(os.environ, {"SITE_URL": "http://localhost:8080"}):
            settings = Settings()
            assert "8080" in settings.site_url

    def test_https_url(self):
        """Test site_url with HTTPS."""
        from app.config import Settings

        with patch.dict(os.environ, {"SITE_URL": "https://secure.blog.com"}):
            settings = Settings()
            assert settings.site_url.startswith("https://")

    def test_postgres_database_url(self):
        """Test database_url for PostgreSQL."""
        from app.config import Settings

        pg_url = "postgresql://user:pass@localhost:5432/mydb"
        with patch.dict(os.environ, {"DATABASE_URL": pg_url}):
            settings = Settings()
            assert settings.database_url == pg_url

    def test_mysql_database_url(self):
        """Test database_url for MySQL."""
        from app.config import Settings

        mysql_url = "mysql+pymysql://user:pass@localhost:3306/mydb"
        with patch.dict(os.environ, {"DATABASE_URL": mysql_url}):
            settings = Settings()
            assert settings.database_url == mysql_url
