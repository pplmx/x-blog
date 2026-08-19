"""add reader_accounts table for reader identity (DEC-059)

Adds a ``reader_accounts`` table (email/password/display_name/token_version/
created_at) so readers can self-register and later own cloud-synced bookmarks.
This is a brand-new table — none of the existing DDL is touched (DEC-009
preserved).

Defensive like the series/push/role migrations: if the table already exists (a
dev DB whose create_all safety net created it first), it is left as-is — no
duplicate-table error on adoption.

Revision ID: f6a0e4b3c2d1
Revises: e5f9d3a2b1c0
Create Date: 2026-08-19 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6a0e4b3c2d1"
down_revision: str | Sequence[str] | None = "e5f9d3a2b1c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("reader_accounts"):
        op.create_table(
            "reader_accounts",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column(
                "email",
                sa.String(length=254),
                nullable=False,
                unique=True,
                index=True,
            ),
            sa.Column("password", sa.String(length=200), nullable=False),
            sa.Column("display_name", sa.String(length=50), nullable=True),
            sa.Column("token_version", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    if sa.inspect(bind).has_table("reader_accounts"):
        op.drop_table("reader_accounts")
