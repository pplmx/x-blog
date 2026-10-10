"""Service layer (Phase 2): business/orchestration on top of ``app.repositories``.

Phase 1 extracted ``app/crud.py`` into ``app/repositories`` (data access). Phase 2
introduces this service package as the layer the HTTP routers depend on. Each
service module is the user-facing orchestration entry point for a domain and
composes the repository data-access functions (re-exported here) with the app's
cross-cutting modules (``app.emailer``, ``app.webpush``, ``app.cache``,
``app.limiter``). Routers are thin HTTP shells that call these services; the old
database-crud facade has been deleted.
"""
