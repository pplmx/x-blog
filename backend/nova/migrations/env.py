from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import app.auth  # noqa: F401 — ensures User model is in metadata
import app.models  # noqa: F401
from app.config import settings
from app.database import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Honour an explicit URL (set by app.migrations.run_migrations for tests on a
# throwaway DB); otherwise fall back to the configured database URL. Without
# this, passing sqlalchemy.url to the Config would be silently overridden and
# a test migration could not point at a temp database.
url = config.get_main_option("sqlalchemy.url") or settings.database_url
config.set_main_option("sqlalchemy.url", url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Build the engine from the explicitly-resolved URL. engine_from_config
    # reads get_section(), which does NOT include a sqlalchemy.url set via
    # Config.set_main_option (that populates attributes only) — falling back
    # to an empty "sqlite:///" would make every online migration fail with
    # "unable to open database file".
    url = config.get_main_option("sqlalchemy.url") or settings.database_url
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
