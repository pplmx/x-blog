"""add reader_notification_prefs table for per-kind reader opt-out (DEC-171, TASK-202)

One row per reader storing which notification kinds may fan out to them
(new_post / reply / thread_comment, all default true = on). A reader who turns
a kind off stops both the durable inbox row and the browser push at every
dispatch point. Additive table; no existing DDL is touched (DEC-009). reader_id
is the primary key (one row per reader) and carries no DB-level FK, matching the
project's SQLite-safe additive-table convention (integrity at the API layer).

Revision ID: k1d6e8f2a4c0b
Revises: j9c5e7d1f3b4
Create Date: 2026-08-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k1d6e8f2a4c0b"
down_revision: str | Sequence[str] | None = "j9c5e7d1f3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        op.create_table(
            "reader_notification_prefs",
            sa.Column("reader_id", sa.Integer(), primary_key=True),
            sa.Column("new_post", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("reply", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("thread_comment", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("reader_notification_prefs")
