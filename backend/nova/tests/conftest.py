import os

# Set test environment variables BEFORE importing app modules.
# Rate limits must be raised before the limiter singleton is created.
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only")
os.environ.setdefault("RATE_LIMIT_AUTH_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_WRITE_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_READ_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_SEARCH_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_COMMENT_PER_MINUTE", "9999")
os.environ.setdefault("RATE_LIMIT_EXPORT_PER_MINUTE", "9999")

import time
from collections.abc import Generator
from contextlib import suppress
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.cache import clear_posts_list_cache
from app.database import Base, get_db
from app.main import app

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


@pytest.fixture(scope="session")
def test_engine(worker_id: str):
    """Create a SQLite test database unique per worker process."""
    db_name = f"test_{worker_id}.db" if worker_id else "test.db"
    engine = create_engine(
        f"sqlite:///{db_name}",
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )

    # Enforce foreign keys so SQLite matches PostgreSQL constraint semantics.
    # Without this, FK violations (e.g. deleting a comment that has replies) are
    # silently ignored — exactly the path the IntegrityError handlers cover.
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):
        # pragma persists for the lifetime of this DBAPI connection
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    # Ensure schema exists once per process
    Base.metadata.create_all(bind=engine)
    yield engine
    engine.dispose()
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
