"""Alembic schema-migration runner.

Single authoritative schema path for both dev and production: ``alembic
upgrade head``. The baseline migration (1e0bb4163cc8) is idempotent/self-adopting
(creates tables + indexes only when missing), so it also upgrades a dev SQLite
DB that predates Alembic (schema built by the old ``Base.metadata.create_all``,
which could never alter existing tables) without a manual ``stamp``.

Replaces the old dev-only ``create_all`` safety net, which left stale dev DBs
missing columns added later (e.g. ``users.token_version``) and broke login with
``no such column``. Completes DEC-011.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

# backend/nova
BACKEND_ROOT = Path(__file__).resolve().parent.parent

_ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
_MIGRATIONS_DIR = BACKEND_ROOT / "migrations"


def run_migrations(db_url: str | None = None) -> None:
    """Bring the schema up to head via Alembic.

    Called from the app lifespan (dev + prod) so every startup is at head and
    a stale dev DB is migrated in place, and from init_db. ``db_url`` overrides
    the configured database URL for tests on a throwaway DB (migrations/env.py
    honours an explicit ``sqlalchemy.url`` over ``settings.database_url``).
    """
    cfg = Config(str(_ALEMBIC_INI))
    cfg.set_main_option("script_location", str(_MIGRATIONS_DIR))
    if db_url:
        cfg.set_main_option("sqlalchemy.url", db_url)
    command.upgrade(cfg, "head")
