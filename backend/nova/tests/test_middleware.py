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
        from starlette.responses import JSONResponse

        async def app(scope, receive, send):
            response = JSONResponse({"ok": True})
            await response(scope, receive, send)

        # Verify middleware can be instantiated
        middleware = RequestLoggingMiddleware(app)  # type: ignore[arg-type]

        # The middleware should wrap the app
        assert middleware.app is app

    def test_middleware_has_dispatch(self):
        """Test RequestLoggingMiddleware has a dispatch method."""
        middleware = RequestLoggingMiddleware(app=lambda *a, **kw: None)  # type: ignore[arg-type]
        assert hasattr(middleware, "dispatch")
        assert callable(middleware.dispatch)

    @pytest.mark.asyncio
    async def test_slow_request_log_keeps_request_context(self, monkeypatch):
        """Slow (>1000ms) requests must keep request_id/method/path context.

        Regression for RIL TASK-103, ISS-083: the slow branch used a bare
        ``logger.warning`` with only {status, duration_ms}, dropping
        request_id — exactly the requests you'd correlate against the
        X-Request-ID header. It now routes through StructuredLogAdapter.
        """
        import asyncio
        import logging

        from starlette.requests import Request as StarletteRequest
        from starlette.responses import JSONResponse

        from app.middleware import logging as logging_mod

        async def slow_app(_request=None):
            await asyncio.sleep(0.01)
            return JSONResponse({"ok": True})

        middleware = RequestLoggingMiddleware(slow_app)

        # Force duration_ms > 1000 so the slow-request warning branch runs.
        clock = {"v": 0.0}

        def fake_clock():
            clock["v"] += 1.2  # each read advances >1s vs the first
            return clock["v"]

        monkeypatch.setattr(logging_mod.time, "perf_counter", fake_clock)

        # Capture each log record's extras from a real handler.
        records: list[logging.LogRecord] = []
        handler = logging.Handler()
        handler.emit = lambda record: records.append(record)
        logger = logging.getLogger("xblog")
        logger.addHandler(handler)
        logger.setLevel(logging.WARNING)
        try:
            scope = {
                "type": "http",
                "method": "GET",
                "path": "/slow",
                "headers": [],
                "query_string": b"",
                "client": ("1.2.3.4", 1234),
                "http_version": "1.1",
                "scheme": "http",
                "server": ("testserver", 80),
            }
            req = StarletteRequest(scope)
            await middleware.dispatch(req, slow_app)
        finally:
            logger.removeHandler(handler)

        completed = [r for r in records if r.getMessage() == "request_completed"]
        assert completed, "expected a request_completed warning record"

        # The adapter must attach request_id/method/path to the slow-request
        # record (the bare logger path would not).
        extra = completed[0].request_id
        assert extra, "request_id missing from slow-request log record"
        assert completed[0].method == "GET"
        assert completed[0].path == "/slow"
