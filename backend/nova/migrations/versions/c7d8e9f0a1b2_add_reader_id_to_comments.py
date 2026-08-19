"""add comments.reader_id for reader-attributed comments (DEC-062)

Adds a nullable ``reader_id`` column to ``comments`` linking a comment to the
reader account that authored it (None = anonymous free-text commenter).

No DB-level FOREIGN KEY: SQLite's alembic dialect cannot add an FK-carrying
column to an existing table without batch-mode table recreation (DEC-009).
Referential integrity is enforced at the ORM layer and by the create-time
guard (identity comes from the reader JWT, never client input). Entirely
additive — no existing DDL is touched. Defensive: if the column is already
present (create_all-era dev DB), it is left as-is.

Revision ID: c7d8e9f0a1b2
Revises: a1b2c3d4e5f6
Create Date: 2026-08-20 00:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d8e9f0a1b2"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _comments_columns(bind) -> set[str]:
    """Existing column names on the comments table (defensive adoption)."""
    return {c["name"] for c in sa.inspect(bind).get_columns("comments")}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    columns = _comments_columns(bind)
    if "reader_id" not in columns:
        op.add_column(
            "comments",
            sa.Column("reader_id", sa.Integer(), nullable=True),
        )
        # Column-level index keeps per-reader history lookups cheap.
        op.create_index(op.f("ix_comments_reader_id"), "comments", ["reader_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    columns = _comments_columns(bind)
    if "reader_id" in columns:
        op.drop_index(op.f("ix_comments_reader_id"), table_name="comments", if_exists=True)
        op.drop_column("comments", "reader_id")
