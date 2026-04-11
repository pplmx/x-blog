import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture(scope="session")
def test_engine():
    engine = create_engine(
        "sqlite:///./test_session.db",
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
    yield engine
    engine.dispose()


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
