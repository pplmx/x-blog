"""add push_subscriptions table for Web Push (DEC-055)

Adds the ``push_subscriptions`` table storing reader browser subscriptions
(endpoint + p256dh/auth keys) so the backend can deliver Web Push
notifications on publish. Entirely additive (new table, no existing DDL
touched, DEC-009 preserved).

Defensive like the round-13 baseline and the role-tier migration: if the
table already exists (a dev DB whose create_all safety net already created it
before this migration ran), it is left as-is and only the version is stamped —
no duplicate-table error on adoption.

Revision ID: d4f8e2c1a0b6
Revises: b3f7a1c9d054
Create Date: 2026-08-18 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f8e2c1a0b6"
down_revision: str | Sequence[str] | None = "b3f7a1c9d054"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("push_subscriptions"):
        return
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("endpoint", sa.String(length=500), nullable=False, unique=True, index=True),
        sa.Column("p256dh", sa.String(length=200), nullable=False),
        sa.Column("auth", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            default=lambda: sa.func.now(),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("push_subscriptions"):
        op.drop_table("push_subscriptions")
