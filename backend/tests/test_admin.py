import pytest

from app.auth import User, get_password_hash


@pytest.fixture
def admin_user(db_session):
    user = User(
        username="admin",
        password=get_password_hash("admin123"),
        is_superuser=True,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def admin_token(client, admin_user):  # noqa: ARG001
    # admin_user is required to create the user in DB before login
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
    def test_list_posts(self, client, auth_headers, admin_user, db_session):
        from app import models

        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()

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

    def test_get_post(self, client, auth_headers, db_session):
        from app import models

        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        response = client.get(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["title"] == "Test"

    def test_update_post(self, client, auth_headers, db_session):
        from app import models

        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        response = client.put(
            f"/api/admin/posts/{post_id}",
            headers=auth_headers,
            json={"title": "Updated Title", "slug": "updated-slug"},
        )
        assert response.status_code == 200

    def test_delete_post(self, client, auth_headers, db_session):
        from app import models

        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db_session.add(post)
        db_session.commit()
        post_id = post.id

        response = client.delete(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200

    def test_list_posts_unauthorized(self, client):
        response = client.get("/api/admin/posts")
        assert response.status_code == 401


class TestAdminCategories:
    def test_list_categories(self, client, auth_headers, db_session):
        from app import models

        category = models.Category(name="Test Category")
        db_session.add(category)
        db_session.commit()

        response = client.get("/api/admin/categories", headers=auth_headers)
        assert response.status_code == 200

    def test_create_category(self, client, auth_headers):
        response = client.post(
            "/api/admin/categories?name=New%20Category",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_delete_category(self, client, auth_headers, db_session):
        from app import models

        category = models.Category(name="Test")
        db_session.add(category)
        db_session.commit()
        cat_id = category.id

        response = client.delete(f"/api/admin/categories/{cat_id}", headers=auth_headers)
        assert response.status_code == 200


class TestAdminTags:
    def test_list_tags(self, client, auth_headers, db_session):
        from app import models

        tag = models.Tag(name="Test Tag")
        db_session.add(tag)
        db_session.commit()

        response = client.get("/api/admin/tags", headers=auth_headers)
        assert response.status_code == 200

    def test_create_tag(self, client, auth_headers):
        response = client.post(
            "/api/admin/tags?name=New%20Tag",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_delete_tag(self, client, auth_headers, db_session):
        from app import models

        tag = models.Tag(name="Test")
        db_session.add(tag)
        db_session.commit()
        tag_id = tag.id

        response = client.delete(f"/api/admin/tags/{tag_id}", headers=auth_headers)
        assert response.status_code == 200
