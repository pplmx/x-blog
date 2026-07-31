"""Health check endpoints."""

from fastapi import APIRouter, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from app.cache import get_cache_info
from app.database import engine
from app.limiter import RATE_LIMIT_READ, limiter


class HealthResponse(BaseModel):
    """Health check response model."""

    status: str
    version: str = "0.1.0"
    checks: dict[str, str] | None = None


class ReadyResponse(BaseModel):
    """Readiness check response model."""

    status: str
    checks: dict[str, str]


class CacheStatsResponse(BaseModel):
    """Cache statistics response model."""

    categories: dict[str, int | float]
    tags: dict[str, int | float]


router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health Check",
    description="Basic health check endpoint.",
)
async def health_check() -> HealthResponse:
    """Basic health check - returns 200 if the service is running."""
    return HealthResponse(status="healthy")


@router.get(
    "/health/ready",
    response_model=ReadyResponse,
    summary="Readiness Check",
    description="Checks if the service is ready to accept traffic.",
)
async def readiness_check() -> ReadyResponse:
    """Readiness check - verifies dependencies like database connection."""
    checks: dict[str, str] = {}

    # Check database connection (sync connection for simplicity)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as e:
        checks["database"] = f"error: {str(e)}"
        return ReadyResponse(
            status="not_ready",
            checks=checks,
        )

    return ReadyResponse(status="ready", checks=checks)


@router.get(
    "/health/live",
    status_code=status.HTTP_200_OK,
    summary="Liveness Check",
    description="Checks if the service process is alive.",
)
async def liveness_check() -> dict[str, str]:
    """Liveness check - returns 200 if the process is alive."""
    return {"status": "alive"}


@router.get(
    "/health/cache",
    response_model=CacheStatsResponse,
    summary="Cache Statistics",
    description="Get cache hit/miss statistics and current cache status.",
)
@limiter.limit(f"{RATE_LIMIT_READ}/minute")
def cache_stats(request: Request) -> CacheStatsResponse:  # noqa: ARG001
    """Get cache statistics for monitoring and debugging."""
    cache_info = get_cache_info()
    return CacheStatsResponse(
        categories=cache_info["categories"],
        tags=cache_info["tags"],
    )
