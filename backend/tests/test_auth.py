import pytest
from app.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    TokenData,
)
from jose import jwt


class TestAuth:
    def test_verify_password_correct(self):
        hashed = get_password_hash("testpass123")
        assert verify_password("testpass123", hashed) is True

    def test_verify_password_wrong(self):
        hashed = get_password_hash("testpass123")
        assert verify_password("wrongpass", hashed) is False

    def test_get_password_hash(self):
        password = "testpassword"
        hashed = get_password_hash(password)
        assert hashed != password
        assert len(hashed) > 0

    def test_create_access_token(self):
        token = create_access_token({"sub": 1})
        assert token is not None
        assert isinstance(token, str)

        payload = jwt.decode(token, "x-blog-secret-key-change-in-production", algorithms=["HS256"])
        assert payload["sub"] == "1"

    def test_token_data(self):
        data = TokenData(user_id=1)
        assert data.user_id == 1


class TestAuthEdgeCases:
    def test_verify_password_empty(self):
        hashed = get_password_hash("")
        assert verify_password("", hashed) is True

    def test_create_access_token_empty_sub(self):
        token = create_access_token({})
        assert token is not None
