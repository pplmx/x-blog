"""add search_logs table for aggregate search analytics (DEC-152, TASK-188)

Privacy-safe, aggregate-only public search-term counts (one row per normalized
query + count + last-searched). Additive table; no existing DDL is touched
(DEC-009).

Revision ID: f5d2a4b3c6e8
Revises: e6c8a0b2d4f6
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f5d2a4b3c6e8"
down_revision: str | Sequence[str] | None = "e6c8a0b2d4f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("search_logs"):
        op.create_table(
            "search_logs",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("query", sa.String(length=200), nullable=False, unique=True, index=True),
            sa.Column("count", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("last_searched_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("search_logs")
