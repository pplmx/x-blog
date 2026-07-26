"""Tests for init_admin module."""

from unittest.mock import MagicMock, patch

from app.init_admin import create_admin


class TestCreateAdmin:
    """Tests for create_admin function."""

    def test_create_admin_creates_when_not_exists(self):
        """Test create_admin creates admin user when it doesn't exist."""
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch("app.init_admin.get_password_hash", return_value="hashed_admin123"),
            patch("builtins.print") as mock_print,
        ):
            create_admin()

        # Verify admin user was created
        mock_db.add.assert_called_once()
        created_user = mock_db.add.call_args[0][0]
        assert created_user.username == "admin"
        assert created_user.password == "hashed_admin123"
        assert created_user.is_superuser is True
        mock_db.commit.assert_called_once()

        # Verify print messages
        mock_print.assert_any_call("Admin user created: admin / admin123")
        mock_print.assert_any_call("WARNING: Please change this password immediately after first login!")

        # Verify db was closed
        mock_db.close.assert_called_once()

    def test_create_admin_uses_env_password(self):
        """Test create_admin uses ADMIN_PASSWORD env var when set."""
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None
        mock_session_local = MagicMock(return_value=mock_db)

        with (
            patch("app.init_admin.SessionLocal", mock_session_local),
            patch("app.init_admin.Base.metadata.create_all"),
            patch("app.init_admin.get_password_hash", return_value="hashed_custom"),
            patch("builtins.print") as mock_print,
            patch("os.getenv", return_value="custom_pass"),
        ):
            create_admin()

        # Verify admin user was created with custom password
        created_user = mock_db.add.call_args[0][0]
        assert created_user.password == "hashed_custom"
        mock_print.assert_any_call("Admin user created: admin / custom_pass")

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
        ):
            from contextlib import suppress

            with suppress(Exception):
                create_admin()

        # Verify db was closed despite error
        mock_db.close.assert_called_once()
