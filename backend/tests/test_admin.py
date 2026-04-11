import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.auth import get_password_hash, User
import app.auth
from app.main import app
from app import models

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_admin_isolated.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True, scope="function")
def ensure_override():
    app.dependency_overrides[get_db] = override_get_db
    yield


@pytest.fixture(autouse=True)
def setup_database():
    import app.auth
    import app.models

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_user():
    db = TestingSessionLocal()
    user = User(
        username="admin",
        password=get_password_hash("admin123"),
        is_superuser=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user


@pytest.fixture
def admin_token(client, admin_user):
    response = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )
    return response.json()["access_token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


class TestAdminLogin:
    def test_login_success(self, client, admin_user):
        response = client.post(
            "/api/admin/login",
            data={"username": "admin", "password": "admin123"},
        )
        assert response.status_code == 200
        assert "access_token" in response.json()

    def test_login_wrong_password(self, client, admin_user):
        response = client.post(
            "/api/admin/login",
            data={"username": "admin", "password": "wrong"},
        )
        assert response.status_code == 401

    def test_login_nonexistent_user(self, client):
        response = client.post(
            "/api/admin/login",
            data={"username": "nonexistent", "password": "password"},
        )
        assert response.status_code == 401


class TestAdminPosts:
    def test_list_posts(self, client, auth_headers, admin_user):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        db.close()

        response = client.get("/api/admin/posts", headers=auth_headers)
        assert response.status_code == 200
        posts = response.json()
        assert len(posts) == 1

    def test_create_post(self, client, auth_headers):
        response = client.post(
            "/api/admin/posts",
            headers=auth_headers,
            json={
                "title": "New Post",
                "slug": "new-post",
                "content": "Post content",
                "published": True,
            },
        )
        assert response.status_code == 200
        assert response.json()["id"] == 1

    def test_get_post(self, client, auth_headers):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        post_id = post.id
        db.close()

        response = client.get(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["title"] == "Test"

    def test_update_post(self, client, auth_headers):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        post_id = post.id
        db.close()

        response = client.put(
            f"/api/admin/posts/{post_id}",
            headers=auth_headers,
            json={"title": "Updated Title", "slug": "updated-slug"},
        )
        assert response.status_code == 200

    def test_delete_post(self, client, auth_headers):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        post_id = post.id
        db.close()

        response = client.delete(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200

    def test_list_posts_unauthorized(self, client):
        response = client.get("/api/admin/posts")
        assert response.status_code == 401


class TestAdminCategories:
    def test_list_categories(self, client, auth_headers):
        db = TestingSessionLocal()
        category = models.Category(name="Test Category")
        db.add(category)
        db.commit()
        db.close()

        response = client.get("/api/admin/categories", headers=auth_headers)
        assert response.status_code == 200

    def test_create_category(self, client, auth_headers):
        response = client.post(
            "/api/admin/categories?name=New%20Category",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_delete_category(self, client, auth_headers):
        db = TestingSessionLocal()
        category = models.Category(name="Test")
        db.add(category)
        db.commit()
        cat_id = category.id
        db.close()

        response = client.delete(f"/api/admin/categories/{cat_id}", headers=auth_headers)
        assert response.status_code == 200


class TestAdminTags:
    def test_list_tags(self, client, auth_headers):
        db = TestingSessionLocal()
        tag = models.Tag(name="Test Tag")
        db.add(tag)
        db.commit()
        db.close()

        response = client.get("/api/admin/tags", headers=auth_headers)
        assert response.status_code == 200

    def test_create_tag(self, client, auth_headers):
        response = client.post(
            "/api/admin/tags?name=New%20Tag",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_delete_tag(self, client, auth_headers):
        db = TestingSessionLocal()
        tag = models.Tag(name="Test")
        db.add(tag)
        db.commit()
        tag_id = tag.id
        db.close()

        response = client.delete(f"/api/admin/tags/{tag_id}", headers=auth_headers)
        assert response.status_code == 200
