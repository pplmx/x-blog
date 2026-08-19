"""Cache-policy middleware: default everything to no-store unless a route opted in.

HTTP has no cacheability default for ``GET``: absent a ``Cache-Control`` header,
browsers and shared caches may heuristically store a response. That is wrong on
three classes of API responses:

- **Private/admin data** (``/api/admin/*``): must never reach a shared cache.
- **Write-on-read counters**: ``POST /api/posts/{id}/view|like`` and the post
  detail ``GET`` carry live ``views``/``likes``; caching them serves stale
  counts.
- **Dynamic content** (search, comments): changes per request without an
  invalidation signal at the HTTP layer.

The policy is explicit-opt-in: a route that wants caching sets a ``Cache-Control``
header itself (see routers/conditional.py, TASK-128) and the middleware leaves it
alone; every other response defaults to ``no-store``. ``setdefault`` preserves
route-set headers and never fights TASK-128's conditional-response helper.
"""

from collections.abc import Callable

from starlette.requests import Request
from starlette.responses import Response


async def add_cache_policy(request: Request, call_next: Callable) -> Response:
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-store")
    return response
