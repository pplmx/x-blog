import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from starlette.requests import ClientDisconnect

from app.cache import cache_clear
from app.database import engine
from app.limiter import limiter
from app.middleware import RequestLoggingMiddleware, get_logger, setup_logging
from app.migrations import run_migrations
from app.routers import admin, categories, comments, posts, search, tags, upload
from app.routers.export import router as export_router
from app.routers.health import router as health_router
from app.routers.rss import rss_router, seo_router
from app.routers.stats import router as stats_router
from app.sentry import setup_sentry

logger = get_logger(__name__)

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "30"))
GZIP_MINIMUM_SIZE = int(os.getenv("GZIP_MINIMUM_SIZE", "500"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Application lifespan handler for startup and shutdown."""
    # Startup
    setup_logging()
    setup_sentry()
    logger.info("app_startup", extra={"version": "0.1.0"})

    # Bring the schema to head via Alembic — the single authoritative schema
    # path for both dev and prod (completes DEC-011). The baseline migration is
    # idempotent/self-adopting, so it upgrades a stale dev SQLite DB in place
    # (the old `Base.metadata.create_all` never altered existing tables and
    # left DBs missing columns like users.token_version, breaking login with
    # "no such column"). Deploy also runs `alembic upgrade head`; re-running it
    # here is a fast idempotent no-op.
    run_migrations()

    # Register graceful shutdown handler
    def shutdown_handler():
        logger.info("app_shutdown_started")
        cache_clear()
        engine.dispose()
        logger.info("app_shutdown_complete")

    # Note: Signal handlers should be registered at the process level
    # when running with uvicorn --timeout-keep-alive or similar

    yield

    # Shutdown
    shutdown_handler()


app = FastAPI(
    title="X-Blog Blog API",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# 3000 = Nuxt container port, 34567 = Nuxt dev port. 3001/3003 were Next.js-era
# ports no longer used by the project (they only diluted the CORS allowlist).
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:34567"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    # Restrict to what the frontend actually uses (issue #20); origins are
    # already an explicit allowlist.
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# Add GZip compression for responses > 500 bytes
app.add_middleware(GZipMiddleware, minimum_size=GZIP_MINIMUM_SIZE)

# Add request logging middleware
app.add_middleware(RequestLoggingMiddleware)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.middleware("http")
async def timeout_middleware(request: Request, call_next):
    """Add request timeout handling."""
    try:
        response = await asyncio.wait_for(
            call_next(request),
            timeout=REQUEST_TIMEOUT,
        )
        return response
    except TimeoutError:
        logger.warning("request_timeout path=%s timeout=%s", request.url.path, REQUEST_TIMEOUT)
        return JSONResponse(
            status_code=504,
            content={
                "error": {
                    "code": "GATEWAY_TIMEOUT",
                    "message": "Request timeout",
                    "details": {"timeout_seconds": REQUEST_TIMEOUT},
                }
            },
        )


app.state.limiter = limiter


def rate_limit_exceeded_handler(_request: Request, _exc: Exception):
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "TOO_MANY_REQUESTS",
                "message": "Too many requests. Please try again later.",
                "details": {},
            }
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    """Handle Pydantic validation errors with consistent format."""
    errors = []
    for error in exc.errors():
        errors.append(
            {
                "field": ".".join(str(loc) for loc in error["loc"]),
                "message": error["msg"],
                "type": error["type"],
            }
        )

    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": {"errors": errors},
            }
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException):
    """Handle HTTP exceptions with consistent format."""
    # Map common status codes to error codes
    code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        422: "VALIDATION_ERROR",
        429: "TOO_MANY_REQUESTS",
        500: "INTERNAL_ERROR",
    }

    error_code = code_map.get(exc.status_code, "ERROR")
    message = exc.detail if isinstance(exc.detail, str) else "An error occurred"

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": error_code,
                "message": message,
                "details": {},
            }
        },
    )


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Catch-all: keep the error envelope consistent and log server-side.

    Without this, an unexpected exception leaks Starlette's raw 500 body.
    Specific handlers (HTTPException, validation, rate limit) take precedence.
    """
    if isinstance(exc, ClientDisconnect):
        # Client aborted mid-request: nothing to respond to, and a full
        # traceback per aborted connection would just flood the error log.
        logger.debug("client_disconnected", extra={"path": request.url.path})
        return Response(status_code=499)
    logger.exception(
        "unhandled_exception",
        extra={"path": request.url.path, "error_type": type(exc).__name__},
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
                "details": {},
            }
        },
    )


app.include_router(health_router)
app.include_router(stats_router)
app.include_router(posts.router)
app.include_router(categories.router)
app.include_router(tags.router)
app.include_router(comments.router)
app.include_router(search.router)
app.include_router(admin.router)
app.include_router(upload.router)
app.include_router(export_router)
app.include_router(rss_router, prefix="/rss")
app.include_router(seo_router)

static_dir = Path(__file__).parent.parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
def read_root():
    return {"message": "X-Blog Blog API"}
