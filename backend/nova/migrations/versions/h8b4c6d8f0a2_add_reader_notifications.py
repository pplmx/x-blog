"""add reader_notifications table for the reader notification inbox (DEC-160, TASK-192)

Durable per-reader notification rows (new post in a followed series/category, a
reply to the reader's comment, a new comment on a followed thread) so a signed-in
reader can review follow/reply/thread activity in-app as a read/unread list,
independent of fire-and-forget browser push. Additive table; no existing DDL is
touched (DEC-009). reader_id is a plain indexed integer (no DB-level FK) matching
the project's SQLite-safe additive-table convention.

Revision ID: h8b4c6d8f0a2
Revises: g7a3b5c9e1d2f
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "h8b4c6d8f0a2"
down_revision: str | Sequence[str] | None = "g7a3b5c9e1d2f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notifications"):
        op.create_table(
            "reader_notifications",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("kind", sa.String(length=32), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("body", sa.String(length=500), nullable=True),
            sa.Column("url", sa.String(length=500), nullable=True),
            sa.Column("read_at", sa.DateTime(), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=True, index=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("reader_notifications")
