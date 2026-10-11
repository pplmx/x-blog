from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC

from sqlalchemy import DateTime, event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import declarative_base
from sqlalchemy.types import TypeDecorator

from app.config import settings

is_sqlite = settings.database_url.startswith("sqlite")

# SQLAlchemy async needs an explicit async driver. Map the configured engine
# dialest to its async counterpart:
#   sqlite:///...          -> sqlite+aiosqlite:///...
#   postgresql://          -> postgresql+asyncpg://
#   postgresql+psycopg2:// -> postgresql+asyncpg://
# Anything else is left untouched (caller misconfiguration surfaces loudly).
if is_sqlite:
    _async_url = settings.database_url.replace("sqlite://", "sqlite+aiosqlite://", 1)
else:
    _async_url = settings.database_url
    for _old in ("postgresql+psycopg2://", "postgresql://"):
        if _async_url.startswith(_old):
            _async_url = "postgresql+asyncpg://" + _async_url.split("://", 1)[1]
            break

# SQLite requires check_same_thread=False for cross-thread use; asyncpg forbids
# it. Pool options mirror the sync engine's production defaults.
_connect_args = {"check_same_thread": False} if is_sqlite else {}
_pool_opts = {}
if not is_sqlite:
    _pool_opts = {
        "pool_size": int(getattr(settings, "pool_size", 10)),
        "max_overflow": int(getattr(settings, "pool_overflow", 20)),
        "pool_pre_ping": True,
        "pool_recycle": 3600,
    }

engine = create_async_engine(_async_url, connect_args=_connect_args, **_pool_opts)


Base = declarative_base()


class NaiveUTCDateTime(TypeDecorator):
    """``DateTime`` that stores the naive-UTC wall clock (DEC-213).

    Every timestamp column in the schema is "timestamp without time zone"
    holding a naive-UTC value. SQLite is lenient and stores whatever it's
    given, but asyncpg strictly rejects binding an AWARE datetime into a naive
    ``TIMESTAMP WITHOUT TIME ZONE`` param ("can't subtract offset-naive and
    offset-aware datetimes") — a latent PG-only defect the async migration
    surface: app code and tests frequently write ``datetime.now(UTC)`` (aware)
    as ORM defaults or seed values. This transparently coerces any aware value
    to naive-UTC at bind (what psycopg2-on-a-UTC-session did implicitly), so
    callers may use either form and storage stays naive-UTC on every dialect.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is not None:
            return value.astimezone(UTC).replace(tzinfo=None)
        return value


# Timezone/SQLite-FK setup for the async engine.
#
# Timezone contract: every timestamp column is naive UTC ("timestamp without
# time zone" storing the UTC wall clock — see the digest domain notes and the
# `naive publish_at/now_naive` convention across crud). Model defaults use
# aware `datetime.now(UTC)`, and psycopg2 adapts an aware value into the
# SESSION TimeZone before storing it in a naive column — so on a server whose
# TimeZone is not UTC (e.g. the dev host's Asia/Shanghai) that aware default is
# silently stored as UTC+offset, skewing every created_at/updated_at vs the
# naive `utc_now_naive()` values the app writes and compares. Pin the session
# to UTC so aware→naive storage is the UTC wall clock on every deployment,
# independent of the server's configured TimeZone.
if not is_sqlite:

    @event.listens_for(engine.sync_engine, "connect")
    def _set_utc_session(dbapi_connection, _connection_record):  # pragma: no cover - db-driver dependent
        # NB: do NOT use `with ...cursor()`. On the real PostgreSQL/asyncpg driver
        # this returns an AsyncAdapt_asyncpg_cursor, which does not implement the
        # context-manager protocol (no __enter__/__exit__) and would raise at
        # every pool checkout ("...does not support the context manager protocol").
        # aiosqlite would mask it; explicit execute avoids the cursor entirely.
        cur = dbapi_connection.cursor()
        cur.execute("SET TIME ZONE 'UTC'")


# SQLite async driver (aiosqlite) exposes a sync cursor on the DBAPI
# connection, so the FK pragma behaves the same as the old sync listener —
# enabled here for parity with PostgreSQL FK enforcement in tests (the
# PRAGMA is set in tests' conftest for the sync path; for async/aiosqlite the
# pragma applies at the connection so CRUD integrity is checked identically).
if is_sqlite:

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_fk(dbapi_connection, _connection_record):  # pragma: no cover - db-driver dependent
        dbapi_connection.execute("PRAGMA foreign_keys=ON")


AsyncSessionLocal = async_sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with AsyncSessionLocal() as db:
        yield db
