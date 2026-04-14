"""Custom exceptions and error codes for the application."""

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    """Standard error codes for the API."""

    # Validation errors
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INVALID_INPUT = "INVALID_INPUT"

    # Not found errors
    NOT_FOUND = "NOT_FOUND"
    POST_NOT_FOUND = "POST_NOT_FOUND"
    CATEGORY_NOT_FOUND = "CATEGORY_NOT_FOUND"
    TAG_NOT_FOUND = "TAG_NOT_FOUND"
    COMMENT_NOT_FOUND = "COMMENT_NOT_FOUND"

    # Authentication/Authorization errors
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    TOKEN_EXPIRED = "TOKEN_EXPIRED"

    # Rate limiting
    RATE_LIMITED = "RATE_LIMITED"
    TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS"

    # Server errors
    INTERNAL_ERROR = "INTERNAL_ERROR"
    DATABASE_ERROR = "DATABASE_ERROR"
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE"

    # Business logic errors
    DUPLICATE_SLUG = "DUPLICATE_SLUG"
    DUPLICATE_NAME = "DUPLICATE_NAME"
    OPERATION_NOT_ALLOWED = "OPERATION_NOT_ALLOWED"


class AppException(Exception):
    """Base application exception."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> dict[str, Any]:
        """Convert exception to dictionary for JSON response."""
        return {
            "code": self.code.value,
            "message": self.message,
            "details": self.details,
        }


class NotFoundException(AppException):
    """Exception for resource not found errors."""

    def __init__(
        self,
        resource: str,
        identifier: str | int | None = None,
        details: dict[str, Any] | None = None,
    ):
        message = f"{resource} not found"
        if identifier:
            message = f"{resource} with id '{identifier}' not found"
        super().__init__(
            code=ErrorCode.NOT_FOUND,
            message=message,
            status_code=404,
            details=details,
        )


class ValidationException(AppException):
    """Exception for validation errors."""

    def __init__(
        self,
        message: str,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(
            code=ErrorCode.VALIDATION_ERROR,
            message=message,
            status_code=422,
            details=details,
        )


class UnauthorizedException(AppException):
    """Exception for authentication errors."""

    def __init__(
        self,
        message: str = "Authentication required",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(
            code=ErrorCode.UNAUTHORIZED,
            message=message,
            status_code=401,
            details=details,
        )


class ForbiddenException(AppException):
    """Exception for authorization errors."""

    def __init__(
        self,
        message: str = "Access denied",
        details: dict[str, Any] | None = None,
    ):
        super().__init__(
            code=ErrorCode.FORBIDDEN,
            message=message,
            status_code=403,
            details=details,
        )


class DuplicateException(AppException):
    """Exception for duplicate resource errors."""

    def __init__(
        self,
        resource: str,
        field: str,
        value: str,
        details: dict[str, Any] | None = None,
    ):
        super().__init__(
            code=ErrorCode.DUPLICATE_NAME,
            message=f"{resource} with {field} '{value}' already exists",
            status_code=409,
            details=details,
        )
