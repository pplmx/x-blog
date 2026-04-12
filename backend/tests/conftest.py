import time
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


def pytest_configure(config):
    """Configure pytest with worker info for parallel testing."""
    worker_id = os.environ.get("PYTEST_XDIST_WORKER", "master")
    # Use unique database per worker
    if worker_id != "master":
        Base.metadata.bind = None


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
    if os.path.exists(f"./{db_name}"):
        try:
            os.remove(f"./{db_name}")
        except:
            pass


@pytest.fixture(scope="function")
def db_session(test_engine):
    connection = test_engine.connect()
    transaction = connection.begin()
    session = sessionmaker(bind=connection)()

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