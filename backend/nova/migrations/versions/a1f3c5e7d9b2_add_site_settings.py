"""add site_settings table for runtime admin settings (DEC-100)

The verified-reader auto-approve trust tier (DEC-098) currently ships as an env
toggle; this additive table lets an admin flip it at runtime (persisted value
wins, env is the fallback when no row exists). Only the table is added — no
existing DDL is touched (DEC-009). Rows are written lazily via the admin
PUT /api/admin/settings/{key} endpoint, so opting not to use the feature leaves
the env default in effect.

Revision ID: a1f3c5e7d9b2
Revises: e8d4c2a6f0b1
Create Date: 2026-08-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1f3c5e7d9b2"
down_revision: str | Sequence[str] | None = "e8d4c2a6f0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("site_settings"):
        op.create_table(
            "site_settings",
            sa.Column("key", sa.String(length=100), primary_key=True),
            sa.Column("value", sa.String(length=255), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("site_settings")
