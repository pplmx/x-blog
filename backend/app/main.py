import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.database import Base, engine

RATE_LIMIT_PER_MINUTE = os.getenv("RATE_LIMIT_PER_MINUTE", "60")
limiter = Limiter(key_func=get_remote_address)
from app.routers import admin, categories, comments, posts, search, tags


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="X-Blog Blog API", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


app.state.limiter = limiter


def rate_limit_exceeded_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=429, content={"detail": "Too many requests"})


from slowapi.errors import RateLimitExceeded

app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.include_router(posts.router)
app.include_router(categories.router)
app.include_router(tags.router)
app.include_router(comments.router)
app.include_router(search.router)
app.include_router(admin.router)


@app.get("/")
def read_root():
    return {"message": "X-Blog Blog API"}
