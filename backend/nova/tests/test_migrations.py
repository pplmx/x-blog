"""Tests for the Alembic-based startup schema path (DEC-011).

The app now migrates to head via ``app.migrations.run_migrations`` instead of
``Base.metadata.create_all``. The baseline migration is self-adopting, so it
must upgrade a create_all-era SQLite DB in place — reproducing the reported
bug where a stale dev DB missing ``users.token_version`` failed admin login
with ``no such column``.
"""

import sqlite3
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
