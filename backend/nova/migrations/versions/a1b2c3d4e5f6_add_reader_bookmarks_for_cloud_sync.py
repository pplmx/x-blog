"""add reader_bookmarks table for cloud-synced bookmarks (DEC-059)

Adds a ``reader_bookmarks`` table (reader_id ↔ post_id unique pair + created_at)
so registered readers can keep a private, server-persisted bookmark list.

Entirely additive: a brand-new table, no existing DDL touched (DEC-009
preserved). Defensive like the other migrations: if the table already exists
(e.g. a create_all-era dev DB), it is left as-is — no duplicate-table error.

Note: reader_id/post_id are deliberately *not* DB-level foreign keys — SQLite's
alembic dialect cannot add FK-carrying columns to existing tables, and the ORM
model mirrors that (plain Integer columns + a unique pair constraint).
Referential integrity is enforced at the ORM layer.

Revision ID: a1b2c3d4e5f6
Revises: f6a0e4b3c2d1
Create Date: 2026-08-19 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "f6a0e4b3c2d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("reader_bookmarks"):
        op.create_table(
            "reader_bookmarks",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("post_id", sa.Integer(), nullable=False, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "post_id", name="uq_reader_bookmarks_reader_post"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    if sa.inspect(bind).has_table("reader_bookmarks"):
        op.drop_table("reader_bookmarks")
