import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def client():
    Base.metadata.create_all(bind=engine)
    yield TestClient(app)
    Base.metadata.drop_all(bind=engine)


def test_create_category(client):
    response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Tech"
    assert "id" in data


def test_list_categories(client):
    client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
    )
    client.post(
        "/api/categories",
        json={
            "name": "Lifestyle",
        },
    )
    response = client.get("/api/categories")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


def test_get_category(client):
    create_response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
    )
    category_id = create_response.json()["id"]
    response = client.get(f"/api/categories/{category_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Tech"


def test_update_category(client):
    create_response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
    )
    category_id = create_response.json()["id"]
    response = client.put(f"/api/categories/{category_id}", json={"name": "Technology"})
    assert response.status_code == 200
    assert response.json()["name"] == "Technology"


def test_delete_category(client):
    create_response = client.post(
        "/api/categories",
        json={
            "name": "Tech",
        },
    )
    category_id = create_response.json()["id"]
    response = client.delete(f"/api/categories/{category_id}")
    assert response.status_code == 204
    get_response = client.get(f"/api/categories/{category_id}")
    assert get_response.status_code == 404
