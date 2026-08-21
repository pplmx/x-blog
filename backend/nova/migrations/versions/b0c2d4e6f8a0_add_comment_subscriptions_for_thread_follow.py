"""add comment_subscriptions table for thread-follow (DEC-078)

A reader who follows a post's discussion gets a Web Push when a *new comment*
is approved. ``comment_subscriptions`` stores the reader↔post pair (unique —
one follow per reader per post).

Entirely additive (new table, no existing DDL touched, DEC-009 preserved).
No DB-level FOREIGN KEY on the columns (SQLite alembic can't add FK-carrying
columns to existing tables; the reader_bookmarks/push_subscriptions tables set
this convention) — integrity is enforced at the API layer.

Defensive like the baseline/role-tier/push migrations: if the table already
exists (a dev DB whose create_all-era safety net already created it before
this migration ran), it is left as-is and only the version is stamped — no
duplicate-table error on adoption.

Revision ID: b0c2d4e6f8a0
Revises: a1f9c3e5b7d2
Create Date: 2026-08-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b0c2d4e6f8a0"
down_revision: str | Sequence[str] | None = "a1f9c3e5b7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("comment_subscriptions"):
        return
    op.create_table(
        "comment_subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reader_id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=True,
            default=lambda: sa.func.now(),
        ),
        sa.UniqueConstraint("reader_id", "post_id", name="uq_comment_subscriptions_reader_post"),
    )
    op.create_index("ix_comment_subscriptions_reader_id", "comment_subscriptions", ["reader_id"])
    op.create_index("ix_comment_subscriptions_post_id", "comment_subscriptions", ["post_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("comment_subscriptions"):
        op.drop_table("comment_subscriptions")
