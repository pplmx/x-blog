"""add reading_history pagination index

Revision ID: m2e7a9c1d3f5
Revises: k1d6e8f2a4c0b
Create Date: 2026-08-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "m2e7a9c1d3f5"
down_revision: str | Sequence[str] | None = "k1d6e8f2a4c0b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INDEX_NAME = "ix_reading_history_reader_viewed_post"


def upgrade() -> None:
    """Add the covering index used by reader-history pagination."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("reading_history"):
        return
    if bind.dialect.name == "postgresql":
        is_valid = bind.execute(
            sa.text(
                """
                SELECT pg_index.indisvalid
                FROM pg_class
                JOIN pg_index ON pg_index.indexrelid = pg_class.oid
                JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                WHERE pg_class.relname = :index_name
                  AND pg_namespace.nspname = current_schema()
                """
            ),
            {"index_name": INDEX_NAME},
        ).scalar()
        if is_valid:
            return
        with op.get_context().autocommit_block():
            if is_valid is False:
                op.drop_index(
                    INDEX_NAME,
                    table_name="reading_history",
                    postgresql_concurrently=True,
                )
            op.create_index(
                INDEX_NAME,
                "reading_history",
                ["reader_id", "viewed_at", "post_id"],
                unique=False,
                postgresql_concurrently=True,
            )
        return

    indexes = {index["name"] for index in inspector.get_indexes("reading_history")}
    if INDEX_NAME not in indexes:
        op.create_index(
            INDEX_NAME,
            "reading_history",
            ["reader_id", "viewed_at", "post_id"],
            unique=False,
        )


def downgrade() -> None:
    """Remove the reader-history pagination index."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("reading_history"):
        return
    indexes = {index["name"] for index in inspector.get_indexes("reading_history")}
    if INDEX_NAME in indexes:
        if bind.dialect.name == "postgresql":
            with op.get_context().autocommit_block():
                op.drop_index(
                    INDEX_NAME,
                    table_name="reading_history",
                    postgresql_concurrently=True,
                )
        else:
            op.drop_index(INDEX_NAME, table_name="reading_history")
