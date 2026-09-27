"""add GIN index on the post-search tsvector expression (performance)

The Postgres ASCII search path (crud.search_posts, DEC-070/DEC-084) matches
``to_tsvector('english', title || ' ' || COALESCE(excerpt, '') || ' ' ||
content) @@ plainto_tsquery('english', ...)`` but had NO supporting index —
every search recomputed to_tsvector over the whole posts table, a full-table
scan + dictionary pass on every keystroke. Measured on a real 5k-post database
(scripts/seed_perf_db.py + bench_perf_db.py, 2026-09-27): a warm single-term
search took 2.8-5.7 seconds. A functional GIN index on the exact query
expression drops it to ~2 ms (Bitmap Index Scan) with no app-code change and
no column/population backfill — PostgreSQL maintains the expression index on
every write transparently.

Deliberately PG-only and migration-only:

- GIN and to_tsvector are PostgreSQL-only; SQLite has no equivalent, and the
  SQLite search path is the ILIKE substring branch anyway (DEC-070), so there
  is nothing for this migration to do there (a no-op keeps ``alembic upgrade
  head`` on the CI SQLite drift gate green).
- The index is NOT declared on the model: a ``__table_args__`` Index with a
  to_tsvector expression would make Base.metadata.create_all (and the test
  suite's SQLite schema) try to evaluate to_tsvector during DDL and fail.
  Autogenerate ignores index differences by default, so ``alembic check`` does
  not flag the DB-only index.

Idempotent like the reading-history pagination index migration
(m2e7a9c1d3f5): if the index already exists (a dev DB that created it by
hand, or a re-run after a partially-applied migration) it is left alone.

Revision ID: a8c9d0e1f2a3
Revises: n3p5r7t9v1x3
Create Date: 2026-09-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c9d0e1f2a3"
down_revision: str | Sequence[str] | None = "n3p5r7t9v1x3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "ix_posts_tsvector_content"

# Must match crud.search_posts's query expression EXACTLY (modulo type casts
# PostgreSQL folds) or the planner will not recognize it as usable for the @@
# match. Verified on a seeded PG: with this definition the ORM-compiled @@
# query plans a Bitmap Index Scan on the index.
INDEX_DDL = (
    "CREATE INDEX CONCURRENTLY "
    f"{INDEX_NAME} ON posts USING gin "
    "(to_tsvector('english', title || ' ' || COALESCE(excerpt, '') || ' ' || content))"
)


def upgrade() -> None:
    """Add the post-search tsvector GIN index on PostgreSQL only."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite (the default test back) has no to_tsvector/GIN and uses the
        # ILIKE substring path — nothing to index here.
        return
    # Idempotency: CONCURRENTLY fails if the index exists; a re-run or a dev
    # DB that already has it should not blow up.
    exists = bind.execute(
        sa.text(
            "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE c.relname = :name AND n.nspname = current_schema()"
        ),
        {"name": INDEX_NAME},
    ).scalar()
    if exists:
        return
    # CREATE INDEX CONCURRENTLY cannot run inside a transaction; autocommit
    # block matches the reading-history index migration precedent.
    with op.get_context().autocommit_block():
        op.execute(sa.text(INDEX_DDL))


def downgrade() -> None:
    """Remove the post-search tsvector GIN index (PostgreSQL only)."""
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    exists = bind.execute(
        sa.text(
            "SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE c.relname = :name AND n.nspname = current_schema()"
        ),
        {"name": INDEX_NAME},
    ).scalar()
    if not exists:
        return
    with op.get_context().autocommit_block():
        op.execute(sa.text(f"DROP INDEX CONCURRENTLY {INDEX_NAME}"))
