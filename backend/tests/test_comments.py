import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app

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


@pytest.fixture(scope="function")
def post(client):
    response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True,
        },
    )
    return response.json()


def test_create_comment(client, post):
    response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["nickname"] == "Test User"
    assert data["email"] == "test@example.com"
    assert data["content"] == "Test comment"
    assert data["post_id"] == post["id"]


def test_list_comments(client, post):
    client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    response = client.get(f"/api/comments/post/{post['id']}")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["nickname"] == "Test User"


def test_delete_comment(client, post):
    create_response = client.post(
        f"/api/comments/post/{post['id']}",
        json={
            "nickname": "Test User",
            "email": "test@example.com",
            "content": "Test comment",
        },
    )
    comment_id = create_response.json()["id"]
    response = client.delete(f"/api/comments/{comment_id}")
    assert response.status_code == 204
    list_response = client.get(f"/api/comments/post/{post['id']}")
    assert len(list_response.json()) == 0
