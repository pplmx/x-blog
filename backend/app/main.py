import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.database import Base, engine
from app.routers import admin, categories, comments, posts, search, tags, upload
from app.routers.rss import rss_router, seo_router

RATE_LIMIT_PER_MINUTE = os.getenv("RATE_LIMIT_PER_MINUTE", "60")
limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="X-Blog Blog API", version="0.1.0", lifespan=lifespan)

ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


app.state.limiter = limiter


def rate_limit_exceeded_handler(_request: Request, _exc: Exception):
    return JSONResponse(status_code=429, content={"detail": "Too many requests"})


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.include_router(posts.router)
app.include_router(categories.router)
app.include_router(tags.router)
app.include_router(comments.router)
app.include_router(search.router)
app.include_router(admin.router)
app.include_router(upload.router)
app.include_router(rss_router, prefix="/rss")
app.include_router(seo_router)

static_dir = Path(__file__).parent.parent / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")


@app.get("/")
def read_root():
    return {"message": "X-Blog Blog API"}
