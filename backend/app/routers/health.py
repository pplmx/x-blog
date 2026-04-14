"""Health check endpoints."""

from fastapi import APIRouter, status
from pydantic import BaseModel
from sqlalchemy import text

from app.database import engine


class HealthResponse(BaseModel):
    """Health check response model."""

    status: str
    version: str = "0.1.0"
    checks: dict[str, str] | None = None


class ReadyResponse(BaseModel):
    """Readiness check response model."""

    status: str
    checks: dict[str, str]


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
