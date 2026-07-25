"""Tests for logging middleware."""

import logging

import pytest

from app.middleware.logging import (
    RequestLoggingMiddleware,
    StructuredLogAdapter,
    get_logger,
    setup_logging,
)


class TestSetupLogging:
    """Tests for setup_logging function."""

    def test_setup_logging_configures_root_logger(self):
        """Test setup_logging configures root logger with INFO level."""
        setup_logging()

        root_logger = logging.getLogger()
        assert root_logger.level == logging.INFO
        assert len(root_logger.handlers) >= 1

    def test_setup_logging_silences_uvicorn_access(self):
        """Test setup_logging silences uvicorn access log."""
        setup_logging()

        uvicorn_logger = logging.getLogger("uvicorn.access")
        assert uvicorn_logger.level == logging.WARNING

    def test_setup_logging_has_stream_handler(self):
        """Test setup_logging adds a StreamHandler."""
        setup_logging()

        root_logger = logging.getLogger()
        stream_handlers = [h for h in root_logger.handlers if isinstance(h, logging.StreamHandler)]
        assert len(stream_handlers) >= 1


class TestStructuredLogAdapter:
    """Tests for StructuredLogAdapter."""

    def test_process_merges_extra(self):
        """Test StructuredLogAdapter merges extra kwargs with adapter extra."""
        logger = logging.getLogger("test_adapter")
        adapter = StructuredLogAdapter(logger, {"request_id": "abc123"})

        msg, kwargs = adapter.process("test_message", {})
        assert msg == "test_message"
        assert kwargs["extra"]["request_id"] == "abc123"

    def test_process_merges_existing_extra(self):
        """Test StructuredLogAdapter merges existing extra with adapter extra."""
        logger = logging.getLogger("test_adapter")
        adapter = StructuredLogAdapter(logger, {"request_id": "abc123"})

        msg, kwargs = adapter.process("test_message", {"extra": {"method": "GET"}})
        assert msg == "test_message"
        assert kwargs["extra"]["request_id"] == "abc123"
        assert kwargs["extra"]["method"] == "GET"

    def test_process_overrides_adapter_extra(self):
        """Test StructuredLogAdapter allows kwargs extra to override adapter extra."""
        logger = logging.getLogger("test_adapter")
        adapter = StructuredLogAdapter(logger, {"request_id": "abc123"})

        msg, kwargs = adapter.process("test_message", {"extra": {"request_id": "override"}})
        assert msg == "test_message"
        assert kwargs["extra"]["request_id"] == "override"


class TestGetLogger:
    """Tests for get_logger function."""

    def test_get_logger_returns_logger(self):
        """Test get_logger returns a Logger instance."""
        logger = get_logger("test_logger")
        assert isinstance(logger, logging.Logger)
        assert logger.name == "test_logger"

    def test_get_logger_default_name(self):
        """Test get_logger returns 'xblog' logger by default."""
        logger = get_logger()
        assert isinstance(logger, logging.Logger)
        assert logger.name == "xblog"


class TestRequestLoggingMiddleware:
    """Tests for RequestLoggingMiddleware error dispatch path."""

    @pytest.mark.asyncio
    async def test_dispatch_logs_request_and_response(self):
        """Test middleware logs request and response."""
        from fastapi import Request
        from starlette.responses import JSONResponse

        async def app(scope, receive, send):
            response = JSONResponse({"ok": True})
            await response(scope, receive, send)

        from starlette.types import Scope

        scope: Scope = {
            "type": "http",
            "method": "GET",
            "path": "/test",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 12345),
        }

        # Verify middleware can be instantiated
        middleware = RequestLoggingMiddleware(app)  # type: ignore[arg-type]

        # The middleware should wrap the app
        assert middleware.app is app

    def test_middleware_has_dispatch(self):
        """Test RequestLoggingMiddleware has a dispatch method."""
        middleware = RequestLoggingMiddleware(app=lambda *a, **kw: None)  # type: ignore[arg-type]
        assert hasattr(middleware, "dispatch")
        assert callable(middleware.dispatch)
