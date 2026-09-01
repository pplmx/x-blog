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

import time
from collections.abc import Generator
from contextlib import suppress
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from app.cache import clear_posts_list_cache
from app.database import Base, get_db
from app.main import app

# When set to a PostgreSQL URL, the whole suite runs against it (one schema
# per xdist worker) instead of per-worker SQLite files — see test_engine.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")

# ---------------------------------------------------------------------------
# The in-memory posts_list_cache survives DB-transaction rollbacks, so without
# clearing it tests can see rolled-back data. Clear it before every test.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _clear_posts_list_cache():
    clear_posts_list_cache()
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
def test_engine(worker_id: str):
    """Create the test database: a SQLite file per worker, or — when
    TEST_DATABASE_URL points at a real PostgreSQL server — a per-worker SCHEMA
    on that server.

    Production is PostgreSQL, but the suite ran on SQLite only, so the PG-only
    code paths (tsvector ``@@`` search, ``ts_headline`` snippets, pg advisory
    digest locks) and any dialect drift (String(N) is not enforced on SQLite,
    naive-UTC storage, unique-NULL semantics) were never exercised. Setting
    TEST_DATABASE_URL runs the whole suite against the deployment dialect.
    """
    if TEST_DATABASE_URL and "postgresql" in TEST_DATABASE_URL:
        # Each xdist worker gets its own schema so concurrent workers never
        # collide on the shared server (the SQLite path isolates workers by
        # file; there is no per-worker database here).
        schema = f"xblog_test_{(worker_id or 'master').lower()}"
        # Cap the per-worker pool so N xdist workers on a many-core box stay
        # under the server's max_connections (e.g. -n auto on 128 cores with
        # the default pool would otherwise exhaust a 100-connection PG).
        engine = create_engine(
            TEST_DATABASE_URL,
            pool_pre_ping=True,
            pool_size=3,
            max_overflow=5,
            pool_recycle=3600,
        )
    else:
        db_name = f"test_{worker_id}.db" if worker_id else "test.db"
        schema = None
        engine = create_engine(
            f"sqlite:///{db_name}",
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
        )

    @event.listens_for(engine, "connect")
    def _dialect_connection_setup(dbapi_connection, _connection_record):
        if schema is not None:
            # Point every pooled connection (schema creation + every query) at
            # this worker's schema, and pin the session to UTC so the aware
            # ORM defaults (datetime.now(UTC)) store as naive-UTC wall clock —
            # the DEC-213 storage contract app/database.py enforces in prod.
            # Without the pin, the server's TimeZone shifts stored datetimes.
            cur = dbapi_connection.cursor()
            cur.execute(f'SET search_path TO "{schema}"')
            cur.execute("SET TIME ZONE 'UTC'")
            cur.close()
        else:
            # Enforce foreign keys so SQLite matches PostgreSQL constraint
            # semantics. Without this, FK violations (e.g. deleting a comment
            # that has replies) are silently ignored — exactly the path the
            # IntegrityError handlers cover.
            dbapi_connection.execute("PRAGMA foreign_keys=ON")

    if schema is not None:
        # Fresh schema per session: drop leftovers from a previous run, then
        # let the same ordered connection setup (above) target it on create.
        with engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))

    # Ensure schema exists once per process
    Base.metadata.create_all(bind=engine)
    yield engine
    if schema is not None:
        with engine.connect() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            conn.commit()
    engine.dispose()
    if schema is None:
        with suppress(Exception):
            Path(db_name).unlink()


# ---------------------------------------------------------------------------
# Database sessions
# ---------------------------------------------------------------------------


@pytest.fixture
def db_session(test_engine) -> Generator[Session]:
    """
    Isolated transaction per test.
    All changes (including fixture commits) are rolled back after the test.
    """
    connection = test_engine.connect()
    connection.begin()
    session = sessionmaker(bind=connection)()
    try:
        yield session
    finally:
        session.close()
        connection.rollback()  # undo everything this test did
        connection.close()


# ---------------------------------------------------------------------------
# FastAPI test client
# ---------------------------------------------------------------------------


@pytest.fixture
def client(db_session: Session) -> TestClient:
    """Test client with isolated DB session injected via dependency override."""

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()
    time.sleep(0.05)  # let connections drain


# ---------------------------------------------------------------------------
# Shared admin user fixtures (per-module, not shared across modules)
# ---------------------------------------------------------------------------


@pytest.fixture
def admin_user(db_session: Session):
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
    db_session.flush()  # make id available, but stay inside transaction
    return user


@pytest.fixture
def admin_token(client: TestClient, admin_user) -> str:  # noqa: ARG001
    """Return a fresh JWT token for the admin user.

    admin_user param ensures the test admin exists in the database before login.
    """
    response = client.post(
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
def editor_user(db_session: Session):
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
    db_session.flush()
    return user


@pytest.fixture
def editor_headers(client: TestClient, editor_user) -> dict:  # noqa: ARG001
    """Authorization header dict for the editor (non-superuser) account."""
    response = client.post(
        "/api/admin/login",
        data={"username": "testeditor", "password": "editorpass123"},
    )
    assert response.status_code == 200, f"Editor login failed: {response.json()}"
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}
