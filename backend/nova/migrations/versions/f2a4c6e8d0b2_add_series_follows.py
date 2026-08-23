"""add series_follows table for 'new part' push (DEC-132, TASK-178)

A signed-in reader can follow a series to be pushed a notification when a new
public post is published in it. Adds the additive ``series_follows`` table
(reader↔series unique pair); no existing DDL is touched (DEC-009).

Revision ID: f2a4c6e8d0b2
Revises: d7e9f1a3b5c7
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2a4c6e8d0b2"
down_revision: str | Sequence[str] | None = "d7e9f1a3b5c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("series_follows"):
        op.create_table(
            "series_follows",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("series_id", sa.Integer(), nullable=False, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "series_id", name="uq_series_follows_reader_series"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("series_follows")
