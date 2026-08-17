"""Logging middleware for structured request/response logging."""

import logging
import time
import uuid
from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


def setup_logging() -> None:
    """Setup structured logging for the application."""
    # Configure root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add JSON-like formatter
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    root_logger.addHandler(handler)

    # Silence uvicorn access log and xblog info-level request logging
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("xblog").setLevel(logging.WARNING)


class StructuredLogAdapter(logging.LoggerAdapter):
    """Custom logger adapter for structured logging."""

    def process(self, msg, kwargs):
        # Merge adapter extra with caller's extra (caller takes priority)
        extra = self.extra or {}
        caller_extra = kwargs.pop("extra", {})
        kwargs["extra"] = {**extra, **caller_extra}
        return msg, kwargs


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to log all requests and responses with structured format."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate request ID
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id

        # Record start time
        start_time = time.perf_counter()

        # Create adapter with request context
        logger = logging.getLogger("xblog")
        extra = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "client_ip": request.client.host if request.client else "unknown",
        }
        adapter = StructuredLogAdapter(logger, extra)

        # Log incoming request (debug level to reduce noise)
        adapter.debug("request_started")

        # Process request
        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log completed request (debug level to reduce noise,
            # only log warnings for slow requests)
            log_data = {
                "status": response.status_code,
                "duration_ms": round(duration_ms, 2),
            }

            if duration_ms > 1000:
                # Use the adapter (not the bare logger) so slow requests keep
                # request_id/method/path/client_ip context — the exact requests
                # you need to correlate against the X-Request-ID response header.
                adapter.warning("request_completed", extra=log_data)
            else:
                adapter.debug("request_completed", extra=log_data)

            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            return response

        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log error with extra data
            log_data = {
                "error": str(e),
                "duration_ms": round(duration_ms, 2),
            }
            adapter.error("request_failed", extra=log_data)
            raise


def get_logger(name: str = "xblog") -> logging.Logger:
    """Get a logger instance."""
    return logging.getLogger(name)
