"""Tests for the Alembic-based startup schema path (DEC-011).

The app now migrates to head via ``app.migrations.run_migrations`` instead of
``Base.metadata.create_all``. The baseline migration is self-adopting, so it
must upgrade a create_all-era SQLite DB in place — reproducing the reported
bug where a stale dev DB missing ``users.token_version`` failed admin login
with ``no such column``.
"""

import sqlite3
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.migrations import run_migrations


@pytest.fixture()
def stale_sqlite_url(tmp_path: Path) -> str:
    """A create_all-era SQLite DB missing users.token_version (schema drift)."""
    db_path = tmp_path / "stale.db"
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username VARCHAR(50) NOT NULL UNIQUE,
                password VARCHAR(200) NOT NULL,
                is_superuser BOOLEAN,
                created_at DATETIME
            );
            """
        )
        conn.commit()
    finally:
        conn.close()
    return f"sqlite:///{db_path}"


def _file(url: str) -> str:
    return url.removeprefix("sqlite:///")


def _query(url: str, sql: str, params: tuple = ()):
    conn = sqlite3.connect(_file(url))
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def test_upgrade_adds_missing_column(stale_sqlite_url: str):
    run_migrations(db_url=stale_sqlite_url)

    cols = {row[1] for row in _query(stale_sqlite_url, "PRAGMA table_info(users)")}
    assert "token_version" in cols

    # The login query ("SELECT ... token_version FROM users WHERE username=?")
    # now succeeds against the upgraded DB.
    rows = _query(
        stale_sqlite_url,
        "SELECT id, username, token_version FROM users WHERE username = ?",
        ("admin",),
    )
    assert rows == []


def test_upgrade_is_idempotent(stale_sqlite_url: str):
    run_migrations(db_url=stale_sqlite_url)
    run_migrations(db_url=stale_sqlite_url)

    cols = [row[1] for row in _query(stale_sqlite_url, "PRAGMA table_info(users)")]
    assert cols.count("token_version") == 1


def test_upgrade_stamps_alembic_version(stale_sqlite_url: str):
    run_migrations(db_url=stale_sqlite_url)

    version = _query(stale_sqlite_url, "SELECT version_num FROM alembic_version")
    assert version and version[0][0]  # reaches head


def test_upgrade_adds_reading_history_pagination_index(stale_sqlite_url: str):
    run_migrations(db_url=stale_sqlite_url)

    indexes = {row[1] for row in _query(stale_sqlite_url, "PRAGMA index_list(reading_history)")}
    assert "ix_reading_history_reader_viewed_post" in indexes

    columns = [
        row[2]
        for row in _query(
            stale_sqlite_url,
            "PRAGMA index_info(ix_reading_history_reader_viewed_post)",
        )
    ]
    assert columns == ["reader_id", "viewed_at", "post_id"]


def test_history_pagination_index_is_created_concurrently_on_postgres(monkeypatch):
    from migrations.versions import m2e7a9c1d3f5_add_reading_history_pagination_index as migration

    class Dialect:
        name = "postgresql"

    class ScalarResult:
        @staticmethod
        def scalar():
            return None

    class Bind:
        dialect = Dialect()

        @staticmethod
        def execute(*_args, **_kwargs):
            return ScalarResult()

    class Inspector:
        @staticmethod
        def has_table(_table_name):
            return True

        @staticmethod
        def get_indexes(_table_name):
            return []

    entered_autocommit = False

    @contextmanager
    def autocommit_block():
        nonlocal entered_autocommit
        entered_autocommit = True
        yield

    class Context:
        pass

    Context.autocommit_block = staticmethod(autocommit_block)

    create_kwargs = {}

    def capture_create_index(*_args, **kwargs):
        create_kwargs.update(kwargs)

    monkeypatch.setattr(migration.op, "get_bind", lambda: Bind())
    monkeypatch.setattr(migration.op, "get_context", lambda: Context())
    monkeypatch.setattr(migration.op, "create_index", capture_create_index)
    monkeypatch.setattr(migration.sa, "inspect", lambda _bind: Inspector())

    migration.upgrade()

    assert entered_autocommit is True
    assert create_kwargs["postgresql_concurrently"] is True


def test_history_pagination_index_rebuilds_invalid_postgres_index(monkeypatch):
    from migrations.versions import m2e7a9c1d3f5_add_reading_history_pagination_index as migration

    class Dialect:
        name = "postgresql"

    class ScalarResult:
        @staticmethod
        def scalar():
            return False

    class Bind:
        dialect = Dialect()

        @staticmethod
        def execute(*_args, **_kwargs):
            return ScalarResult()

    class Inspector:
        @staticmethod
        def has_table(_table_name):
            return True

        @staticmethod
        def get_indexes(_table_name):
            return [{"name": migration.INDEX_NAME}]

    operations = []

    @contextmanager
    def autocommit_block():
        operations.append("autocommit")
        yield

    class Context:
        pass

    Context.autocommit_block = staticmethod(autocommit_block)

    monkeypatch.setattr(migration.op, "get_bind", lambda: Bind())
    monkeypatch.setattr(migration.op, "get_context", lambda: Context())
    monkeypatch.setattr(migration.sa, "inspect", lambda _bind: Inspector())
    monkeypatch.setattr(migration.op, "drop_index", lambda *_args, **_kwargs: operations.append("drop"))
    monkeypatch.setattr(migration.op, "create_index", lambda *_args, **_kwargs: operations.append("create"))

    migration.upgrade()

    assert operations == ["autocommit", "drop", "create"]


def test_redundant_indexes_are_removed_from_create_all_era_schema(monkeypatch):
    from migrations.versions import n3f8b0d2e4a6_remove_redundant_admin_push_endpoint_index as migration

    class Dialect:
        name = "sqlite"

    class Bind:
        dialect = Dialect()

    existing = {
        "comment_subscriptions": [{"name": "ix_comment_subscriptions_id", "unique": False}],
        "admin_push_subscriptions": [
            {"name": "ix_admin_push_subscriptions_id", "unique": False},
            {"name": "ix_admin_push_subscriptions_endpoint", "unique": False},
        ],
        "post_views_daily": [{"name": "ix_post_views_daily_id", "unique": False}],
    }

    class Inspector:
        @staticmethod
        def has_table(table_name):
            return table_name in existing

        @staticmethod
        def get_indexes(table_name):
            return existing[table_name]

    dropped = []
    monkeypatch.setattr(migration.op, "get_bind", lambda: Bind())
    monkeypatch.setattr(migration.sa, "inspect", lambda _bind: Inspector())
    monkeypatch.setattr(
        migration.op,
        "drop_index",
        lambda index_name, *, table_name, **_kwargs: dropped.append((table_name, index_name)),
    )

    migration.upgrade()

    assert dropped == [
        ("comment_subscriptions", "ix_comment_subscriptions_id"),
        ("admin_push_subscriptions", "ix_admin_push_subscriptions_id"),
        ("admin_push_subscriptions", "ix_admin_push_subscriptions_endpoint"),
        ("post_views_daily", "ix_post_views_daily_id"),
    ]
