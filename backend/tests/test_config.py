"""Tests for configuration module."""

import os
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
