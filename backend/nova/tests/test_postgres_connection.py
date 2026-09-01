"""PostgreSQL connection validation tests.

These tests verify that the backend can connect to and operate against a real
PostgreSQL database. They are only executed when the ``TEST_DATABASE_URL``
environment variable is set to a PostgreSQL URL (or when ``DATABASE_URL``
points to PostgreSQL). Otherwise they are skipped.
"""

import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

# Skip this entire module if PostgreSQL is not configured for testing.
postgres_url = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
skip_postgres = pytest.mark.skipif(
    not postgres_url or "postgresql" not in postgres_url,
    reason="PostgreSQL not configured for testing (set TEST_DATABASE_URL to a postgresql:// URL)",
)


def _get_test_url() -> str:
    """Return the PostgreSQL URL for testing."""
    return postgres_url  # type: ignore[return-value]


@skip_postgres
def test_postgres_connection_established():
    """Verify we can establish a connection to the PostgreSQL instance."""
    engine = create_engine(_get_test_url())
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1")).scalar()
        assert result == 1
    engine.dispose()


@skip_postgres
def test_postgres_version_returned():
    """Verify PostgreSQL version is returned and is a PostgreSQL server."""
    engine = create_engine(_get_test_url())
    with engine.connect() as conn:
        version = conn.execute(text("SHOW server_version")).scalar()
        assert version, "Expected a non-empty server version string"
        assert "PostgreSQL" in version or version[0].isdigit(), f"Expected PostgreSQL version string, got: {version}"
    engine.dispose()


@skip_postgres
def test_postgres_database_name():
    """Verify the correct database name is connected."""
    engine = create_engine(_get_test_url())
    with engine.connect() as conn:
        db_name = conn.execute(text("SELECT current_database()")).scalar()
        assert db_name, "Expected a non-empty database name"
    engine.dispose()


@skip_postgres
def test_postgres_schema_creation():
    """Verify SQLAlchemy can create schema (tables) in PostgreSQL.

    Isolation: created/dropped inside a dedicated temp schema via search_path so
    this test NEVER touches the target database's public schema — an earlier
    version did ``Base.metadata.drop_all()`` on public, which silently destroys
    every table of whatever database TEST_DATABASE_URL points at (the round-211
    harness made `just test-backend-postgres` actually runnable, arming that
    footgun against a shared/dev DB). Nodes only act on the temp schema now.
    """
    from sqlalchemy import event

    from app.database import Base

    SCHEMA = "xblog_pgconn_schema_test"
    engine = create_engine(_get_test_url())

    # Point every pooled connection at the temp schema (create + inspect).
    # IMPORTANT: register BEFORE any connection is opened — a pooled connection
    # established earlier is reused as-is, and without the search_path the
    # unqualified CREATE TABLEs would land in the public schema.
    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_connection, _connection_record):
        cur = dbapi_connection.cursor()
        cur.execute(f'SET search_path TO "{SCHEMA}"')
        cur.close()

    with engine.begin() as conn:
        conn.execute(text(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'))
        conn.execute(text(f'CREATE SCHEMA "{SCHEMA}"'))

    try:
        Base.metadata.create_all(bind=engine)

        # Verify at least one table was created inside the temp schema.
        inspector = __import__("sqlalchemy", fromlist=["inspect"]).inspect(engine)
        tables = inspector.get_table_names()
        assert len(tables) > 0, "Expected at least one table to be created in PostgreSQL"
    finally:
        with engine.connect() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{SCHEMA}" CASCADE'))
            conn.commit()
        engine.dispose()


@skip_postgres
def test_postgres_transaction_rollback():
    """Verify transactions can be rolled back in PostgreSQL."""
    engine = create_engine(_get_test_url())
    with engine.connect() as conn:
        trans = conn.begin()
        conn.execute(text("CREATE TABLE _test_txn_rollback (id SERIAL PRIMARY KEY)"))
        # Verify table exists
        result = conn.execute(text("SELECT to_regclass('_test_txn_rollback')").bindparams()).scalar()
        assert result is not None, "Table should exist before rollback"
        trans.rollback()

    # Table should NOT exist after rollback.
    with engine.connect() as conn:
        result = conn.execute(text("SELECT to_regclass('_test_txn_rollback')")).scalar()
        assert result is None, "Table should not exist after rollback"
    engine.dispose()


@skip_postgres
def test_postgres_basic_crud():
    """Verify basic CRUD operations work in PostgreSQL."""
    engine = create_engine(_get_test_url())
    with engine.connect() as conn:
        trans = conn.begin()
        conn.execute(text("CREATE TABLE _test_crud (id SERIAL PRIMARY KEY, name TEXT NOT NULL)"))

        # Insert
        conn.execute(text("INSERT INTO _test_crud (name) VALUES (:name)"), {"name": "Alice"})
        conn.execute(text("INSERT INTO _test_crud (name) VALUES (:name)"), {"name": "Bob"})

        # Read
        count = conn.execute(text("SELECT COUNT(*) FROM _test_crud")).scalar()
        assert count == 2, f"Expected 2 rows, got {count}"

        # Update
        conn.execute(text("UPDATE _test_crud SET name = :name WHERE name = :old"), {"name": "Charlie", "old": "Alice"})
        updated = conn.execute(text("SELECT name FROM _test_crud WHERE name = :name"), {"name": "Charlie"}).scalar()
        assert updated == "Charlie"

        # Delete
        conn.execute(text("DELETE FROM _test_crud WHERE name = :name"), {"name": "Bob"})
        count = conn.execute(text("SELECT COUNT(*) FROM _test_crud")).scalar()
        assert count == 1, f"Expected 1 row after delete, got {count}"

        trans.rollback()  # cleanup
    engine.dispose()


@skip_postgres
def test_postgres_engine_creation():
    """Verify SQLAlchemy engine can be created from the PostgreSQL URL."""
    engine: Engine = create_engine(_get_test_url())
    assert engine is not None
    # Verify the engine dialect is PostgreSQL.
    assert "postgresql" in str(engine.dialect.name), f"Expected postgresql dialect, got: {engine.dialect.name}"
    engine.dispose()


@skip_postgres
def test_postgres_concurrent_connections():
    """Verify PostgreSQL can handle multiple concurrent connections."""
    engines = [create_engine(_get_test_url()) for _ in range(3)]
    try:
        for i, engine in enumerate(engines):
            with engine.connect() as conn:
                result = conn.execute(text("SELECT :val"), {"val": i}).scalar()
                assert result == i
    finally:
        for engine in engines:
            engine.dispose()
