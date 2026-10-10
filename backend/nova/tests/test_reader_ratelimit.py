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
from httpx import ASGITransport, AsyncClient
from slowapi.errors import RateLimitExceeded

from app import limiter as app_limiter
from app.database import get_db
from app.routers import reader as reader_module

WRITE_LIMIT_ENV = "RATE_LIMIT_WRITE_PER_MINUTE"

_slug_counter = 0


async def _register(client, email="rl@example.com", password="readerpass123"):
    """Register a reader against the (async) mini client; returns the Response."""
    return await client.post(
        "/api/reader/register",
        json={"email": email, "password": password},
    )


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_post(db_session, slug=None):
    """Create a visible post against the AsyncSession.

    Created as a *draft* first (published=False) so ``create_post``'s new-post
    web-push fan-out is skipped, then flipped to published in a second commit.
    The fan-out reads ``post.title`` after an internal commit that expires the
    row, which lazy-loads against the AsyncSession and raises MissingGreenlet
    whenever VAPID is configured (as it is in the test env) — see the same
    failure in ``tests/test_crud.py::TestCreatePost::test_create_post_with_all_fields``.
    The bookmark route only requires the post to be publicly visible, so the
    post-hoc flip satisfies it without touching the app.
    """
    from app.repositories import create_post
    from app.schemas import PostCreate

    global _slug_counter
    _slug_counter += 1
    post = await create_post(
        db_session,
        PostCreate(
            title="Rate-limited post",
            slug=slug or f"rl-post-{_slug_counter}",
            content="# Hello\n\nWorld",
            published=False,
        ),
    )
    post.published = True
    await db_session.commit()
    await db_session.refresh(post)
    return post


def _reload_with_write_limit(db_session) -> AsyncClient:
    """Build a mini app that enforces ``value``/minute on reader writes.

    The shared ``client`` app baked its limits at import (9999 in tests), so a
    fresh limiter + reloaded reader router are needed to observe a 429. The
    shared app's routers keep their original (already-reloaded-free) function
    objects, so this does not leak into later tests. The mini app is served
    over ``httpx.AsyncClient`` (same loop as the test) so it can drive the
    shared ``AsyncSession`` like the main ``client`` fixture does.
    """
    importlib.reload(app_limiter)
    importlib.reload(reader_module)

    mini = FastAPI()
    mini.state.limiter = app_limiter.limiter

    def rate_limit_exceeded_handler(_req, _exc):
        return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"})

    mini.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

    async def override_get_db():
        yield db_session

    mini.dependency_overrides[get_db] = override_get_db
    mini.include_router(reader_module.router)
    return AsyncClient(transport=ASGITransport(app=mini), base_url="http://test")


class TestReaderWritesAreRateLimited:
    async def test_write_burst_exceeds_limit_and_429s(self, db_session):
        os.environ[WRITE_LIMIT_ENV] = "2"
        try:
            client = _reload_with_write_limit(db_session)
            token = (await _register(client)).json()["access_token"]
            post = await _create_post(db_session)
            h = _auth(token)
            put = f"/api/reader/me/bookmarks/{post.id}"
            try:
                assert (await client.put(put, headers=h)).status_code == 201  # write #1
                # write #2 (idempotent)
                assert (await client.put(put, headers=h)).status_code == 200
                # Reads share no bucket and carry no limiter → fine under burst.
                assert (await client.get("/api/reader/me/bookmarks", headers=h)).status_code == 200
                # Third write in the minute exceeds the 2/min cap → 429.
                assert (await client.put(put, headers=h)).status_code == 429
            finally:
                await client.aclose()
        finally:
            os.environ[WRITE_LIMIT_ENV] = "9999"
            importlib.reload(app_limiter)
            importlib.reload(reader_module)


class TestReaderReadsStayUnlimited:
    async def test_bookmark_list_get_has_no_rate_limit(self, db_session):
        os.environ[WRITE_LIMIT_ENV] = "2"
        try:
            client = _reload_with_write_limit(db_session)
            token = (await _register(client)).json()["access_token"]
            await _create_post(db_session)
            h = _auth(token)
            try:
                for _ in range(5):
                    resp = await client.get("/api/reader/me/bookmarks", headers=h)
                    assert resp.status_code == 200
            finally:
                await client.aclose()
        finally:
            os.environ[WRITE_LIMIT_ENV] = "9999"
            importlib.reload(app_limiter)
            importlib.reload(reader_module)
