"""Database-crud facade for the blog.

Phase 1 of the repository cleanup: all logic moved verbatim into the
``app.repositories`` package (split by domain, shared helpers in
``app.repositories._base``). This module is now a pure re-export facade so that
every existing ``from app import crud`` / ``from app.crud import X`` import —
across all routers and tests — keeps working with zero caller changes.

Phase 2 will migrate routers/tests to import from ``app.repositories`` /
``app.services`` and delete this facade.
"""

from app.repositories import *  # noqa: F401,F403
