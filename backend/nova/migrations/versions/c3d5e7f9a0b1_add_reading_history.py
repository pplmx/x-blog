"""add reading_history table for server-backed reader view history (DEC-116)

Signed-in readers' Continue-reading trail is now persisted server-side so it
follows them across devices (TASK-170). One row per (reader, post) pair with a
``viewed_at`` stamp — an upsert updates the timestamp in place (no duplicates).
Only the new additive table is created; no existing DDL is touched (DEC-009).

Revision ID: c3d5e7f9a0b1
Revises: b2d4f6a8c0e2
Create Date: 2026-08-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d5e7f9a0b1"
down_revision: str | Sequence[str] | None = "b2d4f6a8c0e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reading_history"):
        op.create_table(
            "reading_history",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("post_id", sa.Integer(), nullable=False, index=True),
            sa.Column("viewed_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "post_id", name="uq_reading_history_reader_post"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("reading_history")
