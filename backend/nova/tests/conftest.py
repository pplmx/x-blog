import os

# Set test environment variables BEFORE importing app modules.
# Rate limits must be raised before the limiter singleton is created.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only")
os.environ.setdefault("RATE_LIMIT_AUTH_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_REGISTER_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_WRITE_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_READ_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_SEARCH_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_COMMENT_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_EXPORT_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_NEWSLETTER_PER_MINUTE", "9999")

# Web Push VAPID keypair for tests — a real ES256 (P-256) pair so the public
# key is a valid 65-byte EC point and pywebpush can build an authenticated
# VAPID token. Env is read lazily in app.webpush so tests can also exercise
# the unconfigured (503) path via monkeypatch.delenv.
try:
    from cryptography.hazmat.primitives.asymmetric import ec

    _vapid_key = ec.generate_private_key(ec.SECP256R1())
    _vapid_pub = _vapid_key.public_key().public_numbers()
    _pub_bytes = b"\x04" + _vapid_pub.x.to_bytes(32, "big") + _vapid_pub.y.to_bytes(32, "big")
    _priv_bytes = _vapid_key.private_numbers().private_value.to_bytes(32, "big")
    import base64

    os.environ.setdefault(
        "VAPID_PUBLIC_KEY",
        base64.urlsafe_b64encode(_pub_bytes).rstrip(b"=").decode("ascii"),
    )
    os.environ.setdefault(
        "VAPID_PRIVATE_KEY",
        base64.urlsafe_b64encode(_priv_bytes).rstrip(b"=").decode("ascii"),
    )
    os.environ.setdefault("VAPID_SUBJECT", "mailto:test@example.com")
except Exception:  # pragma: no cover - cryptography is a hard dependency
    pass

import asyncio
from collections.abc import AsyncIterator
from contextlib import suppress
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.cache import (
    clear_categories_cache,
    clear_posts_list_cache,
    clear_tags_cache,
    clear_upload_refs_cache,
)
from app.database import Base, get_db
from app.main import app

# When set to a PostgreSQL URL, the whole suite runs against it (one schema
# per xdist worker) instead of per-worker SQLite files — see test_engine.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

# ---------------------------------------------------------------------------
# The in-memory TTL caches survive DB-transaction rollbacks, so without
# clearing them tests can see rolled-back data. Clear every one before each
# test: posts_list_cache was handled historically, but categories_cache and
# tags_cache (30-min TTL) leaked stale taxonomy from earlier tests too — e.g.
# GET /api/categories asserted empty from a test whose DB was rolled back
# would see a previous test's cached categories. Clearing forces recompute
# against the current (empty) transaction.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_public_caches():
    clear_posts_list_cache()
    clear_categories_cache()
    clear_tags_cache()
    clear_upload_refs_cache()
    yield


# ---------------------------------------------------------------------------
# Engine & database (session-scoped, worker-aware)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def worker_id(request: pytest.FixtureRequest) -> str:
    """Return pytest-xdist worker ID ('gw0', 'gw1', ...) or 'master'."""
    if hasattr(request.config, "workerinput"):
        return request.config.workerinput["workerid"]
    return "master"


@pytest.fixture(scope="session", autouse=True)
def _isolate_pg_advisory_lock_per_worker(worker_id: str):
    """Give each PG xdist worker its own digest advisory-lock key.

    Postgres advisory locks are DATABASE-scoped, not schema-scoped. Under
    TEST_DATABASE_URL the conftest gives every worker its own schema, but the
    digest job's fixed ``_DIGEST_LOCK_KEY`` lives on the shared database — so
    the advisory-lock-contention test in one worker made every OTHER worker's
    digest send return ``locked`` (digest suite red under ``-n`` on PG while
    each test passed in isolation; PG-parity regression found round 448). Set a
    per-worker key derivation so parallel workers never contend, while the
    in-worker lock/contention semantics stay intact. Production (no
    TEST_DATABASE_URL) never sets the env var and keeps the stable key.
    """
    if TEST_DATABASE_URL and "postgresql" in TEST_DATABASE_URL:
        from app.digest import _DIGEST_LOCK_KEY, _DIGEST_LOCK_KEY_ENV

        # Worker-stable salt: 'gw0' -> distinguishable from 'gw1', 'master'
        # untouched. Deterministic across restart, unlike id()/random.
        salt = sum(ord(c) for c in worker_id)
        os.environ[_DIGEST_LOCK_KEY_ENV] = str(_DIGEST_LOCK_KEY + salt)
    yield


@pytest.fixture
def isolated_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Give each media-library test its OWN upload root.

    The media-library tests otherwise fall back to the real ``static/uploads``
    directory that every xdist worker shares. Under ``-n auto`` a delete test in
    one worker removes a file while another worker's list test stats it
    (FileNotFoundError), so the full suite flaked with a different upload test
    failing on every run. Point ``app.routers.upload.STATIC_DIR`` at a fresh
    temp dir per test (requested via ``pytestmark`` on test_upload) so workers
    never touch each other's files, mirroring the per-worker SQLite database
    above. The route derives ``upload_dir``/``uploads_root`` from this module
    constant at call time; the tests resolve it through the module too, so both
    stay consistent.
    """
    from app.routers import upload

    monkeypatch.setattr(upload, "STATIC_DIR", tmp_path)
    yield tmp_path


@pytest.fixture(scope="session")
def test_engine(worker_id: str) -> AsyncEngine | None:
    """Create the test database: a SQLite file per worker, or — when
    TEST_DATABASE_URL points at a real PostgreSQL server — a per-worker SCHEMA
    on that server.

    Production is PostgreSQL, but the suite ran on SQLite only, so the PG-only
    code paths (tsvector ``@@`` search, ``ts_headline`` snippets, pg advisory
    digest locks) and any dialect drift (String(N) is not enforced on SQLite,
    naive-UTC storage, unique-NULL semantics) were never exercised. Setting
    TEST_DATABASE_URL runs the whole suite against the deployment dialect.

    This is an async engine (aiosqlite / asyncpg) — the app's data layer is
    now async (async SQLAlchemy), so every test session + client must go
    through AsyncSession.
    """
    if TEST_DATABASE_URL and "postgresql" in TEST_DATABASE_URL:
        # Each xdist worker gets its own schema so concurrent workers never
        # collide on the shared server (the SQLite path isolates workers by
        # file; there is no per-worker database here).
        schema = f"xblog_test_{(worker_id or 'master').lower()}"
        url = "postgresql+asyncpg://" + TEST_DATABASE_URL.split("://", 1)[1]
        # NullPool: every checkout is a fresh connection bound to the current
        # pytest-asyncio function-scoped event loop. asyncpg pins a connection
        # to the loop that created it, so reusing a pooled connection across
        # tests (each on a new loop) raises "attached to a different loop";
        # aiosqlite tolerates reuse, asyncpg does not. Cap is moot under
        # NullPool (one live connection at a time per checkout) so N xdist
        # workers stay well under the server's max_connections.
        engine = create_async_engine(
            url,
            poolclass=NullPool,
        )
    else:
        db_name = f"test_{worker_id}.db" if worker_id else "test.db"
        schema = None
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{db_name}",
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
        )

    @event.listens_for(engine.sync_engine, "connect")
    def _dialect_connection_setup(dbapi_connection, _connection_record):
        if schema is not None:
            # Point every pooled connection (schema creation + every query) at
            # this worker's schema, and pin the session to UTC so the aware
            # ORM defaults (datetime.now(UTC)) store as naive-UTC wall clock —
            # the DEC-213 storage contract app/database.py enforces in prod.
            cur = dbapi_connection.cursor()
            cur.execute(f'SET search_path TO "{schema}"')
            cur.execute("SET TIME ZONE 'UTC'")
            cur.close()
        else:
            # Enforce foreign keys so SQLite matches PostgreSQL constraint
            # semantics.
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

    if schema is not None:
        # asyncpg resets the connection (dropping `SET search_path`) when a
        # failed transaction is rolled back — the push unique-key race test
        # exercised this: after IntegrityError + rollback every query landed in
        # the public schema and `relation does not exist` (PG dialect parity,
        # async migration). Re-apply the worker schema pin on every transaction
        # begin so post-rollback statements stay in the worker schema.
        @event.listens_for(engine.sync_engine, "begin")
        def _reapply_search_path(conn):
            conn.exec_driver_sql(f'SET search_path TO "{schema}"')

    async def _setup():
        if schema is not None:
            # Fresh schema per session: drop leftovers from a previous run,
            # then let the connection setup target it on create.
            async with engine.begin() as conn:
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
                await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        # Ensure schema exists once per process
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    # pytest-asyncio: schedule async setup on the loop. Because test_engine is
    # session-scoped and pytest-asyncio's event loop is function-scoped by
    # default, run the DB schema setup synchronously at fixture-time via a
    # one-shot loop run.
    import asyncio

    asyncio.run(_setup())
    yield engine
    if schema is not None:
        import asyncio

        async def _teardown():
            async with engine.connect() as conn:
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))

        asyncio.run(_teardown())
    import asyncio

    async def _dispose():
        await engine.dispose()

    asyncio.run(_dispose())
    if schema is None:
        with suppress(Exception):
            Path(db_name).unlink()


# ---------------------------------------------------------------------------
# Database sessions
# ---------------------------------------------------------------------------


@pytest.fixture
async def db_session(test_engine) -> AsyncIterator[AsyncSession]:
    """
    Isolated transaction per test.
    All changes (including fixture commits) are rolled back after the test.
    Uses an AsyncSession bound to a single connection's transaction, so the
    ORM work inside a test shares one transaction that is rolled back at the
    end (matching the old sync behavior).
    """
    async with test_engine.connect() as connection:
        await connection.begin()
        session = AsyncSession(bind=connection, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await connection.rollback()  # undo everything this test did


@pytest.fixture
async def pg_scratch_engine(worker_id: str) -> AsyncEngine | None:
    """Dedicated per-worker engine for PG-only tests that create/drop whole
    table sets (digest lock contention, CJK search).

    Like ``test_engine``, this points each worker at its own scratch schema
    (``xblog_pgscratch_gwN``) and pins every pooled connection to it via
    search_path. Async (asyncpg) to match the async data layer.
    """
    if not (TEST_DATABASE_URL and "postgresql" in TEST_DATABASE_URL):
        yield None
        return
    schema = f"xblog_pgscratch_{(worker_id or 'master').lower()}"
    url = "postgresql+asyncpg://" + TEST_DATABASE_URL.split("://", 1)[1]
    engine = create_async_engine(url, poolclass=NullPool)

    @event.listens_for(engine.sync_engine, "connect")
    def _pin_scratch(dbapi_connection, _connection_record):
        cur = dbapi_connection.cursor()
        cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
        cur.execute(f'SET search_path TO "{schema}"')
        cur.execute("SET TIME ZONE 'UTC'")
        cur.close()

    # Re-apply the schema pin on transaction begin (asyncpg resets the
    # connection — dropping SET search_path — after a rolled-back failed
    # transaction; without this, post-rollback queries hit the public schema).
    @event.listens_for(engine.sync_engine, "begin")
    def _reapply_scratch_search_path(conn):
        conn.exec_driver_sql(f'SET search_path TO "{schema}"')

    try:
        yield engine
    finally:
        async with engine.connect() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await conn.commit()
        await engine.dispose()


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------


@pytest.fixture
async def client(db_session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """Async test client with isolated DB session injected via dependency override."""

    async def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    # Starlette's ServerErrorMiddleware sends the 500/error-envelope response,
    # then unconditionally re-raises so servers/logs see it. The old sync
    # TestClient defaulted raise_server_exceptions=False (swallow); httpx's
    # ASGITransport defaults raise_app_exceptions=True (re-raise). Match the
    # prior behavior so unhandled-exception tests see the envelope, not the
    # raw RuntimeError (async migration).
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()
    await asyncio.sleep(0.05)  # let connections drain


# ---------------------------------------------------------------------------
# Shared admin user fixtures (per-module, not shared across modules)
# ---------------------------------------------------------------------------


@pytest.fixture
async def admin_user(db_session: AsyncSession):
    """
    Create admin user within the test's transaction.
    The transaction is rolled back after the test, so no cleanup needed.
    """
    from app.auth import ROLE_SUPERUSER, User, get_password_hash

    user = User(
        username="testadmin",
        password=get_password_hash("testpass123"),
        role=ROLE_SUPERUSER,
        is_superuser=True,
    )
    db_session.add(user)
    await db_session.flush()  # make id available, but stay inside transaction
    return user


@pytest.fixture
async def admin_token(client: AsyncClient, admin_user) -> str:  # noqa: ARG001
    """Return a fresh JWT token for the admin user.

    admin_user param ensures the test admin exists in the database before login.
    """
    response = await client.post(
        "/api/admin/login",
        data={"username": "testadmin", "password": "testpass123"},
    )
    assert response.status_code == 200, f"Login failed: {response.json()}"
    return response.json()["access_token"]


@pytest.fixture
def auth_headers(admin_token: str) -> dict:
    """Authorization header dict for admin requests."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
async def editor_user(db_session: AsyncSession):
    """
    Create a non-superuser editor admin within the test's transaction.
    Editors can moderate content (posts/comments/categories/tags) but cannot
    manage users/export/batch (DEC-054, TASK-115).
    """
    from app.auth import ROLE_EDITOR, User, get_password_hash

    user = User(
        username="testeditor",
        password=get_password_hash("editorpass123"),
        role=ROLE_EDITOR,
        is_superuser=False,
    )
    db_session.add(user)
    await db_session.flush()
    return user


@pytest.fixture
async def editor_headers(client: AsyncClient, editor_user) -> dict:  # noqa: ARG001
    """Authorization header dict for the editor (non-superuser) account."""
    response = await client.post(
        "/api/admin/login",
        data={"username": "testeditor", "password": "editorpass123"},
    )
    assert response.status_code == 200, f"Editor login failed: {response.json()}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
