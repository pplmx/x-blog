"""Tests for sentry module."""

from unittest.mock import MagicMock, patch


class TestSetupSentry:
    """Tests for setup_sentry function."""

    def test_setup_sentry_no_dsn(self):
        """Test setup_sentry returns early when no DSN is configured."""
        from app.sentry import setup_sentry

        with patch("sentry_sdk.init") as mock_init:
            setup_sentry()

        # sentry_sdk.init should NOT be called when DSN is not set
        mock_init.assert_not_called()

    def test_setup_sentry_with_dsn(self):
        """Test setup_sentry initializes sentry when DSN is configured."""
        from app.sentry import setup_sentry

        with (
            patch("app.sentry.sentry_sdk.init") as mock_init,
            patch("app.config.settings.sentry_dsn", "https://test@example.com/123"),
        ):
            setup_sentry()

        mock_init.assert_called_once()
        call_kwargs = mock_init.call_args
        assert call_kwargs[1]["dsn"] == "https://test@example.com/123"
        assert call_kwargs[1]["environment"] == "production"
        assert call_kwargs[1]["traces_sample_rate"] == 0.1
        assert call_kwargs[1]["send_default_pii"] is False

    def test_setup_sentry_integrations(self):
        """Test setup_sentry configures FastAPI and SQLAlchemy integrations."""
        from app.sentry import setup_sentry

        with (
            patch("app.sentry.sentry_sdk.init") as mock_init,
            patch("app.config.settings.sentry_dsn", "https://test@example.com/123"),
        ):
            setup_sentry()

        call_kwargs = mock_init.call_args
        integrations = call_kwargs[1]["integrations"]
        assert len(integrations) == 2
        # Verify integration types (FastApiIntegration and SqlalchemyIntegration)
        integration_types = [type(i).__name__ for i in integrations]
        assert "FastApiIntegration" in integration_types
        assert "SqlalchemyIntegration" in integration_types
