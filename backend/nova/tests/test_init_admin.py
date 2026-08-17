"""Tests for init_admin module."""

import os
from unittest.mock import MagicMock, patch

import pytest

from app.init_admin import create_admin


def _mock_db():
    mock_db = MagicMock()
    mock_db.query.return_value.filter.return_value.first.return_value = None
    return mock_db


class TestCreateAdmin:
    """Tests for create_admin function."""

    def test_create_admin_creates_when_not_exists(self):
        """Test create_admin creates admin user when it doesn't exist (dev default)."""
        mock_db = _mock_db()
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch("app.init_admin.get_password_hash", return_value="hashed_admin123"),
            patch.dict(os.environ, {"APP_ENV": "development"}, clear=True),
            patch("builtins.print") as mock_print,
        ):
            create_admin()

        # Verify admin user was created
        mock_db.add.assert_called_once()
        created_user = mock_db.add.call_args[0][0]
        assert created_user.username == "admin"
        assert created_user.password == "hashed_admin123"
        assert created_user.is_superuser is True
        # role is the authoritative admin discriminator (DEC-054); a superuser
        # must be stamped as such or every superuser-only endpoint 403s.
        from app.auth import ROLE_SUPERUSER

        assert created_user.role == ROLE_SUPERUSER
        mock_db.commit.assert_called_once()

        # Verify print messages
        mock_print.assert_any_call("Admin user created: admin / admin123")
        mock_print.assert_any_call("WARNING: Please change this password immediately after first login!")

        # Verify db was closed
        mock_db.close.assert_called_once()

    def test_create_admin_uses_env_password(self):
        """Test create_admin uses ADMIN_PASSWORD env var when set."""
        mock_db = _mock_db()
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch("app.init_admin.get_password_hash", return_value="hashed_custom"),
            patch.dict(os.environ, {"ADMIN_PASSWORD": "custom_pass", "APP_ENV": "production"}, clear=True),
            patch("builtins.print") as mock_print,
        ):
            create_admin()

        # Verify admin user was created with custom password
        created_user = mock_db.add.call_args[0][0]
        assert created_user.password == "hashed_custom"
        # Password is never printed outside development
        mock_print.assert_any_call("Admin user created: admin")
        for call in mock_print.call_args_list:
            assert "admin / " not in call.args[0]

    def test_create_admin_fails_closed_without_env_password(self):
        """Test create_admin refuses to run without ADMIN_PASSWORD outside development."""
        mock_db = _mock_db()
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch.dict(os.environ, {"APP_ENV": "production"}, clear=True),
            pytest.raises(RuntimeError, match="ADMIN_PASSWORD"),
        ):
            create_admin()

        # No user was created
        mock_db.add.assert_not_called()

    def test_create_admin_fails_closed_when_env_unset(self):
        """Test create_admin defaults to production semantics when APP_ENV is unset."""
        mock_db = _mock_db()
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch.dict(os.environ, {}, clear=True),
            pytest.raises(RuntimeError, match="ADMIN_PASSWORD"),
        ):
            create_admin()

    def test_create_admin_skips_when_exists(self):
        """Test create_admin skips creation when admin already exists."""
        mock_db = MagicMock()
        existing_user = MagicMock()
        existing_user.username = "admin"
        mock_db.query.return_value.filter.return_value.first.return_value = existing_user
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch.dict(os.environ, {"APP_ENV": "development"}, clear=True),
            patch("builtins.print") as mock_print,
        ):
            create_admin()

        # Verify no user was added
        mock_db.add.assert_not_called()
        mock_db.commit.assert_not_called()

        # Verify print message
        mock_print.assert_any_call("Admin user already exists")

        # Verify db was closed
        mock_db.close.assert_called_once()

    def test_create_admin_closes_db_on_error(self):
        """Test create_admin closes db session even on error."""
        mock_db = MagicMock()
        mock_db.query.side_effect = Exception("DB error")
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch.dict(os.environ, {"APP_ENV": "development"}, clear=True),
        ):
            from contextlib import suppress

            with suppress(Exception):
                create_admin()

        # Verify db was closed despite error
        mock_db.close.assert_called_once()
