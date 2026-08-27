"""add tag_follows table for durable reader tag follows (DEC-195, TASK-215)

Tags are the fine-grained subscription axis categories are too coarse for — a
reader follows ``rust``, not a whole taxonomy. Mirrors ``category_follows``
(DEC-140): durable reader↔tag unique pair + ``notify`` flag that decouples
tracking (the home follows-feed) from push/new-post dispatch. Additive table,
no existing DDL is touched (DEC-009).

Revision ID: q6c9d1e3a5b7
Revises: p7d2e4f6a8b0
Create Date: 2026-08-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "q6c9d1e3a5b7"
down_revision: str | Sequence[str] | None = "p7d2e4f6a8b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("tag_follows"):
        op.create_table(
            "tag_follows",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("tag_id", sa.Integer(), nullable=False, index=True),
            sa.Column("notify", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "tag_id", name="uq_tag_follows_reader_tag"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("tag_follows")
