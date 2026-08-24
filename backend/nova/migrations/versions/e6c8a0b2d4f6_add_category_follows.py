"""add category_follows table for durable reader category follows (DEC-140, TASK-182)

A reader can follow a category as a durable, cross-device intent (distinct from
the per-device new-post category pin on PushSubscription, DEC-076). Adds the
additive ``category_follows`` table (reader↔category unique pair + notify flag);
no existing DDL is touched (DEC-009).

Revision ID: e6c8a0b2d4f6
Revises: f4b2a6c8e0d4
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6c8a0b2d4f6"
down_revision: str | Sequence[str] | None = "f4b2a6c8e0d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("category_follows"):
        op.create_table(
            "category_follows",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("category_id", sa.Integer(), nullable=False, index=True),
            sa.Column("notify", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "category_id", name="uq_category_follows_reader_category"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("category_follows")
