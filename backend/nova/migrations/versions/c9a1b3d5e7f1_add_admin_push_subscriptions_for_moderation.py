"""add admin_push_subscriptions table for moderation alerts (DEC-080)

The blog moderates every comment, and the author only learns a comment is
pending by re-opening the admin moderation queue. ``admin_push_subscriptions``
lets an admin (superuser or editor) opt a browser into a Web Push when a new
comment is created, deep-linking to the moderation queue.

Deliberately separate from ``push_subscriptions``: reader fan-outs (the
superuser broadcast) query every ``PushSubscription`` row, so mixing admin rows
in would leak moderation pushes into reader broadcasts (DEC-080).

Entirely additive (new table, no existing DDL touched, DEC-009 preserved).
No DB-level FOREIGN KEY on the columns (SQLite alembic can't add FK-carrying
columns to existing tables; the push_subscriptions/comment_subscriptions
tables set this convention) — integrity is enforced at the API layer.

Defensive like the baseline/comment_subscriptions migrations: if the table
already exists (a dev DB whose create_all-era safety net already created it
before this migration ran), it is left as-is and only the version is stamped —
no duplicate-table error on adoption.

Revision ID: c9a1b3d5e7f1
Revises: b0c2d4e6f8a0
Create Date: 2026-08-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9a1b3d5e7f1"
down_revision: str | Sequence[str] | None = "b0c2d4e6f8a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("admin_push_subscriptions"):
        return
    op.create_table(
        "admin_push_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(length=500), nullable=False, unique=True),
        sa.Column("p256dh", sa.String(length=200), nullable=False),
        sa.Column("auth", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            default=lambda: sa.func.now(),
        ),
    )
    op.create_index("ix_admin_push_subscriptions_user_id", "admin_push_subscriptions", ["user_id"])
    op.create_index("ix_admin_push_subscriptions_endpoint", "admin_push_subscriptions", ["endpoint"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("admin_push_subscriptions"):
        op.drop_table("admin_push_subscriptions")
