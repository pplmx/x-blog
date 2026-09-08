"""Reader write-endpoint rate limiting (TASK-330).

Every authenticated reader *mutation* (bookmarks, folders, follows, history,
comment edit/delete, notification reads) now carries the write cap
(``RATE_LIMIT_WRITE``, default 30/min) — the security review found none of
them limited, so a reader (or a burst of manual requests) could slam e.g.
the 1000-row history import with no per-IP backstop. Reads stay unlimited.

slowapi in this stack does not emit X-RateLimit-* headers for FastAPI routes
(views return models, not Response objects), so the regression signal is real
enforcement: reload ``app.limiter`` + ``app.routers.reader`` with a tiny
RATE_LIMIT_WRITE_PER_MINUTE, mount the real reader router on a minimal app
with that fresh limiter, and assert the burst trips 429 on the write route
while the read route under the same burst stays 200.
"""

import importlib
import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded

from app import limiter as app_limiter
from app.database import get_db
from app.routers import reader as reader_module
from tests.test_reader_bookmarks import _auth, _create_post, _register

WRITE_LIMIT_ENV = "RATE_LIMIT_WRITE_PER_MINUTE"


def _reload_with_write_limit(db_session) -> TestClient:
    """Build a mini app that enforces ``value``/minute on reader writes.

    The shared ``client`` app baked its limits at import (9999 in tests), so a
    fresh limiter + reloaded reader router are needed to observe a 429. The
    shared app's routers keep their original (already-reloaded-free) function
    objects, so this does not leak into later tests.
    """
    importlib.reload(app_limiter)
    importlib.reload(reader_module)

    mini = FastAPI()
    mini.state.limiter = app_limiter.limiter

    def rate_limit_exceeded_handler(_req, _exc):
        return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})

    mini.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

    def override_get_db():
        yield db_session

    mini.dependency_overrides[get_db] = override_get_db
    mini.include_router(reader_module.router)
    return TestClient(mini, raise_server_exceptions=False)


class TestReaderWritesAreRateLimited:
    def test_write_burst_exceeds_limit_and_429s(self, db_session):
        os.environ[WRITE_LIMIT_ENV] = "2"
        try:
            client = _reload_with_write_limit(db_session)
            token = _register(client).json()["access_token"]
            post = _create_post(db_session)
            h = _auth(token)
            put = f"/api/reader/me/bookmarks/{post.id}"

            assert client.put(put, headers=h).status_code == 201  # write #1
            assert client.put(put, headers=h).status_code == 200  # write #2 (idempotent)
            # Reads share no bucket and carry no limiter → fine under the burst.
            assert client.get("/api/reader/me/bookmarks", headers=h).status_code == 200
            # Third write in the minute exceeds the 2/min cap → 429.
            assert client.put(put, headers=h).status_code == 429
        finally:
            os.environ[WRITE_LIMIT_ENV] = "9999"
            importlib.reload(app_limiter)
            importlib.reload(reader_module)


class TestReaderReadsStayUnlimited:
    def test_bookmark_list_get_has_no_rate_limit(self, db_session):
        os.environ[WRITE_LIMIT_ENV] = "2"
        try:
            client = _reload_with_write_limit(db_session)
            token = _register(client).json()["access_token"]
            _create_post(db_session)
            h = _auth(token)
            for _ in range(5):
                assert client.get("/api/reader/me/bookmarks", headers=h).status_code == 200
        finally:
            os.environ[WRITE_LIMIT_ENV] = "9999"
            importlib.reload(app_limiter)
            importlib.reload(reader_module)
