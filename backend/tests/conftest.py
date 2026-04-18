import os

# Set test environment variables before importing app modules
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-testing-only")

import time
from contextlib import suppress
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture(scope="session")
def test_engine(worker_id):
    """Create test database engine, unique per worker."""
    db_name = f"test_{worker_id}.db" if worker_id else "test.db"
    engine = create_engine(
        f"sqlite:///./{db_name}",
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
    yield engine
    engine.dispose()
    # Clean up
    with suppress(Exception):
        Path(db_name).unlink()


@pytest.fixture(scope="function")
def db_session(test_engine):
    connection = test_engine.connect()
    transaction = connection.begin()
    session = sessionmaker(bind=connection)()

    # Create all tables for tests using db_session directly
    Base.metadata.create_all(bind=test_engine)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture(scope="function")
def client(db_session, test_engine):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    Base.metadata.create_all(bind=test_engine)
    yield TestClient(app)

    app.dependency_overrides.clear()

    # Give time for connections to close
    time.sleep(0.1)


@pytest.fixture(scope="session")
def worker_id(request):
    """Get pytest-xdist worker ID."""
    if hasattr(request.config, "workerinput"):
        return request.config.workerinput["workerid"]
    return "master"
