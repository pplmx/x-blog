"""Tests for custom exceptions."""

import pytest

from app.exceptions import (
    AppException,
    DuplicateException,
    ErrorCode,
    ForbiddenException,
    NotFoundException,
    UnauthorizedException,
    ValidationException,
)


class TestErrorCode:
    """Tests for ErrorCode enum."""

    def test_error_code_values(self):
        """Test ErrorCode has expected values."""
        assert ErrorCode.VALIDATION_ERROR == "VALIDATION_ERROR"
        assert ErrorCode.INVALID_INPUT == "INVALID_INPUT"
        assert ErrorCode.NOT_FOUND == "NOT_FOUND"
        assert ErrorCode.POST_NOT_FOUND == "POST_NOT_FOUND"
        assert ErrorCode.CATEGORY_NOT_FOUND == "CATEGORY_NOT_FOUND"
        assert ErrorCode.TAG_NOT_FOUND == "TAG_NOT_FOUND"
        assert ErrorCode.COMMENT_NOT_FOUND == "COMMENT_NOT_FOUND"
        assert ErrorCode.UNAUTHORIZED == "UNAUTHORIZED"
        assert ErrorCode.FORBIDDEN == "FORBIDDEN"
        assert ErrorCode.INVALID_CREDENTIALS == "INVALID_CREDENTIALS"
        assert ErrorCode.TOKEN_EXPIRED == "TOKEN_EXPIRED"
        assert ErrorCode.RATE_LIMITED == "RATE_LIMITED"
        assert ErrorCode.TOO_MANY_REQUESTS == "TOO_MANY_REQUESTS"
        assert ErrorCode.INTERNAL_ERROR == "INTERNAL_ERROR"
        assert ErrorCode.DATABASE_ERROR == "DATABASE_ERROR"
        assert ErrorCode.SERVICE_UNAVAILABLE == "SERVICE_UNAVAILABLE"
        assert ErrorCode.DUPLICATE_SLUG == "DUPLICATE_SLUG"
        assert ErrorCode.DUPLICATE_NAME == "DUPLICATE_NAME"
        assert ErrorCode.OPERATION_NOT_ALLOWED == "OPERATION_NOT_ALLOWED"

    def test_error_code_is_str_enum(self):
        """Test ErrorCode is a string enum."""
        assert isinstance(ErrorCode.NOT_FOUND, str)


class TestAppException:
    """Tests for base AppException class."""

    def test_app_exception_creation(self):
        """Test creating AppException with all parameters."""
        exc = AppException(
            code=ErrorCode.VALIDATION_ERROR,
            message="Invalid input",
            status_code=422,
            details={"field": "email", "reason": "invalid format"},
        )
        assert exc.code == ErrorCode.VALIDATION_ERROR
        assert exc.message == "Invalid input"
        assert exc.status_code == 422
        assert exc.details["field"] == "email"

    def test_app_exception_default_status_code(self):
        """Test AppException default status code is 400."""
        exc = AppException(
            code=ErrorCode.INVALID_INPUT,
            message="Bad request",
        )
        assert exc.status_code == 400

    def test_app_exception_default_details(self):
        """Test AppException default details is empty dict."""
        exc = AppException(
            code=ErrorCode.INTERNAL_ERROR,
            message="Internal error",
        )
        assert exc.details == {}

    def test_app_exception_to_dict(self):
        """Test to_dict() method returns correct structure."""
        exc = AppException(
            code=ErrorCode.VALIDATION_ERROR,
            message="Validation failed",
            status_code=422,
            details={"errors": ["field1 required"]},
        )
        result = exc.to_dict()
        assert result == {
            "code": "VALIDATION_ERROR",
            "message": "Validation failed",
            "details": {"errors": ["field1 required"]},
        }

    def test_app_exception_to_dict_code_value(self):
        """Test to_dict() uses code.value for string representation."""
        exc = AppException(
            code=ErrorCode.NOT_FOUND,
            message="Not found",
        )
        result = exc.to_dict()
        assert result["code"] == "NOT_FOUND"
        assert isinstance(result["code"], str)

    def test_app_exception_inherits_from_exception(self):
        """Test AppException inherits from Exception."""
        exc = AppException(
            code=ErrorCode.INTERNAL_ERROR,
            message="Test",
        )
        assert isinstance(exc, Exception)

    def test_app_exception_super_init_called(self):
        """Test AppException calls super().__init__ with message."""
        exc = AppException(
            code=ErrorCode.INTERNAL_ERROR,
            message="Base message",
        )
        assert str(exc) == "Base message"


class TestNotFoundException:
    """Tests for NotFoundException class."""

    def test_not_found_exception_default(self):
        """Test NotFoundException with just resource name."""
        exc = NotFoundException(resource="Post")
        assert exc.code == ErrorCode.NOT_FOUND
        assert exc.message == "Post not found"
        assert exc.status_code == 404

    def test_not_found_exception_with_identifier_int(self):
        """Test NotFoundException with integer identifier."""
        exc = NotFoundException(resource="Category", identifier=42)
        assert exc.message == "Category with id '42' not found"

    def test_not_found_exception_with_identifier_str(self):
        """Test NotFoundException with string identifier."""
        exc = NotFoundException(resource="Tag", identifier="python")
        assert exc.message == "Tag with id 'python' not found"

    def test_not_found_exception_with_details(self):
        """Test NotFoundException with additional details."""
        exc = NotFoundException(
            resource="Post",
            identifier=5,
            details={"searched_in": "published_posts"},
        )
        assert exc.details["searched_in"] == "published_posts"

    def test_not_found_exception_to_dict(self):
        """Test to_dict() method."""
        exc = NotFoundException(resource="Comment", identifier=10)
        result = exc.to_dict()
        assert result["code"] == "NOT_FOUND"
        assert "Comment" in result["message"]
        assert "10" in result["message"]

    def test_not_found_exception_not_found_codes(self):
        """Test specific NOT_FOUND error codes are available."""
        assert ErrorCode.POST_NOT_FOUND == "POST_NOT_FOUND"
        assert ErrorCode.CATEGORY_NOT_FOUND == "CATEGORY_NOT_FOUND"
        assert ErrorCode.TAG_NOT_FOUND == "TAG_NOT_FOUND"
        assert ErrorCode.COMMENT_NOT_FOUND == "COMMENT_NOT_FOUND"


class TestValidationException:
    """Tests for ValidationException class."""

    def test_validation_exception_creation(self):
        """Test creating ValidationException."""
        exc = ValidationException(message="Invalid email format")
        assert exc.code == ErrorCode.VALIDATION_ERROR
        assert exc.message == "Invalid email format"
        assert exc.status_code == 422

    def test_validation_exception_with_details(self):
        """Test ValidationException with field details."""
        exc = ValidationException(
            message="Validation failed",
            details={"field": "username", "constraint": "min_length: 3"},
        )
        assert exc.details["field"] == "username"
        assert exc.status_code == 422

    def test_validation_exception_to_dict(self):
        """Test to_dict() method."""
        exc = ValidationException(
            message="Input validation failed",
            details={"errors": ["email is required"]},
        )
        result = exc.to_dict()
        assert result["code"] == "VALIDATION_ERROR"
        assert result["message"] == "Input validation failed"
        assert result["details"]["errors"] == ["email is required"]


class TestUnauthorizedException:
    """Tests for UnauthorizedException class."""

    def test_unauthorized_exception_default_message(self):
        """Test UnauthorizedException default message."""
        exc = UnauthorizedException()
        assert exc.code == ErrorCode.UNAUTHORIZED
        assert exc.message == "Authentication required"
        assert exc.status_code == 401

    def test_unauthorized_exception_custom_message(self):
        """Test UnauthorizedException with custom message."""
        exc = UnauthorizedException(message="Invalid token")
        assert exc.message == "Invalid token"
        assert exc.status_code == 401

    def test_unauthorized_exception_with_details(self):
        """Test UnauthorizedException with details."""
        exc = UnauthorizedException(
            message="Token expired",
            details={"token_type": "access", "expires_in": 3600},
        )
        assert exc.details["token_type"] == "access"
        assert exc.status_code == 401

    def test_unauthorized_exception_to_dict(self):
        """Test to_dict() method."""
        exc = UnauthorizedException(message="Invalid credentials")
        result = exc.to_dict()
        assert result["code"] == "UNAUTHORIZED"
        assert result["message"] == "Invalid credentials"
        assert result["details"] == {}


class TestForbiddenException:
    """Tests for ForbiddenException class."""

    def test_forbidden_exception_default_message(self):
        """Test ForbiddenException default message."""
        exc = ForbiddenException()
        assert exc.code == ErrorCode.FORBIDDEN
        assert exc.message == "Access denied"
        assert exc.status_code == 403

    def test_forbidden_exception_custom_message(self):
        """Test ForbiddenException with custom message."""
        exc = ForbiddenException(message="Admin access required")
        assert exc.message == "Admin access required"

    def test_forbidden_exception_with_details(self):
        """Test ForbiddenException with details."""
        exc = ForbiddenException(
            message="Not allowed",
            details={"required_role": "admin", "current_role": "user"},
        )
        assert exc.details["required_role"] == "admin"

    def test_forbidden_exception_to_dict(self):
        """Test to_dict() method."""
        exc = ForbiddenException(message="Insufficient permissions")
        result = exc.to_dict()
        assert result["code"] == "FORBIDDEN"
        assert result["message"] == "Insufficient permissions"


class TestDuplicateException:
    """Tests for DuplicateException class."""

    def test_duplicate_exception_creation(self):
        """Test creating DuplicateException."""
        exc = DuplicateException(
            resource="Category",
            field="name",
            value="Technology",
        )
        assert exc.code == ErrorCode.DUPLICATE_NAME
        assert exc.message == "Category with name 'Technology' already exists"
        assert exc.status_code == 409

    def test_duplicate_exception_with_identifier(self):
        """Test DuplicateException with slug field."""
        exc = DuplicateException(
            resource="Post",
            field="slug",
            value="my-post",
        )
        assert "slug" in exc.message
        assert "my-post" in exc.message

    def test_duplicate_exception_with_details(self):
        """Test DuplicateException with additional details."""
        exc = DuplicateException(
            resource="Tag",
            field="name",
            value="python",
            details={"existing_id": 5},
        )
        assert exc.details["existing_id"] == 5

    def test_duplicate_exception_to_dict(self):
        """Test to_dict() method."""
        exc = DuplicateException(
            resource="Category",
            field="name",
            value="Tech",
        )
        result = exc.to_dict()
        assert result["code"] == "DUPLICATE_NAME"
        assert "Category" in result["message"]
        assert "Tech" in result["message"]


class TestExceptionChaining:
    """Tests for exception chaining behavior."""

    def test_exception_raising_and_catching(self):
        """Test that exceptions can be raised and caught."""
        with pytest.raises(NotFoundException) as exc_info:
            raise NotFoundException(resource="Post", identifier=999)
        assert "Post" in str(exc_info.value)

    def test_exception_message_preserved(self):
        """Test that exception message is preserved when raised."""
        msg = "Specific error message"
        with pytest.raises(AppException) as exc_info:
            raise AppException(code=ErrorCode.INTERNAL_ERROR, message=msg)
        assert str(exc_info.value) == msg


class TestExceptionStatusCodes:
    """Tests for HTTP status code assignments."""

    def test_validation_exception_status_422(self):
        """Test ValidationException has 422 status code."""
        exc = ValidationException(message="Test")
        assert exc.status_code == 422

    def test_not_found_exception_status_404(self):
        """Test NotFoundException has 404 status code."""
        exc = NotFoundException(resource="Test")
        assert exc.status_code == 404

    def test_unauthorized_exception_status_401(self):
        """Test UnauthorizedException has 401 status code."""
        exc = UnauthorizedException()
        assert exc.status_code == 401

    def test_forbidden_exception_status_403(self):
        """Test ForbiddenException has 403 status code."""
        exc = ForbiddenException()
        assert exc.status_code == 403

    def test_duplicate_exception_status_409(self):
        """Test DuplicateException has 409 status code."""
        exc = DuplicateException(resource="Test", field="name", value="test")
        assert exc.status_code == 409

    def test_base_app_exception_default_400(self):
        """Test base AppException default status is 400."""
        exc = AppException(code=ErrorCode.INVALID_INPUT, message="Test")
        assert exc.status_code == 400