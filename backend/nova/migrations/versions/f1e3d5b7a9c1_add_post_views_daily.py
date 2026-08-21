"""add post_views_daily table for reading-trend analytics (DEC-086)

One row per (post, calendar day) with a monotonic view counter, upserted from
the same write-on-read path as ``posts.views``. Powers the admin dashboard's
per-day readership trend + in-period top posts.

Entirely additive (new table, no existing DDL touched, DEC-009 preserved).
No DB-level FOREIGN KEY on post_id (SQLite alembic can't add FK-carrying
columns to existing tables; the reader_bookmarks/comment_subscriptions tables
set this convention). Defensive like the comment_subscriptions migration: if
the table already exists (a create_all-era dev DB), it is left as-is and only
the version is stamped.

Revision ID: f1e3d5b7a9c1
Revises: e6a2d4b8f0c2
Create Date: 2026-08-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1e3d5b7a9c1"
down_revision: str | Sequence[str] | None = "e6a2d4b8f0c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("post_views_daily"):
        return
    op.create_table(
        "post_views_daily",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("views", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("post_id", "day", name="uq_post_views_daily_post_day"),
    )
    op.create_index("ix_post_views_daily_post_id", "post_views_daily", ["post_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("post_views_daily"):
        op.drop_table("post_views_daily")
