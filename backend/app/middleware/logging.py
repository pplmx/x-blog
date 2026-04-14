"""Logging middleware for structured request/response logging."""

import logging
import time
import uuid
from collections.abc import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


def setup_logging() -> None:
    """Setup structured logging for the application."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(message)s",
    )
    # Configure uvicorn access log
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware to log all requests and responses with structured format."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Generate request ID
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id

        # Record start time
        start_time = time.perf_counter()

        # Log incoming request
        logger = logging.getLogger("xblog")
        logger.info(
            "request_started",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            client_ip=request.client.host if request.client else "unknown",
        )

        # Process request
        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log completed request
            log_level = logging.WARNING if duration_ms > 1000 else logging.INFO
            logger.log(
                log_level,
                "request_completed",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=round(duration_ms, 2),
                client_ip=request.client.host if request.client else "unknown",
            )

            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            return response

        except Exception as e:
            duration_ms = (time.perf_counter() - start_time) * 1000

            # Log error
            logger.error(
                "request_failed",
                request_id=request_id,
                method=request.method,
                path=request.url.path,
                error=str(e),
                duration_ms=round(duration_ms, 2),
                client_ip=request.client.host if request.client else "unknown",
            )
            raise


def get_logger(name: str = "xblog") -> logging.Logger:
    """Get a logger instance."""
    return logging.getLogger(name)
