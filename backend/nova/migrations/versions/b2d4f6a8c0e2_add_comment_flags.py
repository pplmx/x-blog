"""add comment_flags table for reader-driven moderation reports (DEC-108)

Readers can flag an inappropriate comment for moderator review. The additive
``comment_flags`` table stores one row per (comment, ip_key) so a visitor can
flag a comment at most once (unique pair = idempotent, no click spam) and the
moderator sees a count of distinct reporters. Only the new table is added — no
existing DDL is touched (DEC-009).

Revision ID: b2d4f6a8c0e2
Revises: a1f3c5e7d9b2
Create Date: 2026-08-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d4f6a8c0e2"
down_revision: str | Sequence[str] | None = "a1f3c5e7d9b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("comment_flags"):
        op.create_table(
            "comment_flags",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("comment_id", sa.Integer(), nullable=False, index=True),
            sa.Column("ip_key", sa.String(length=50), nullable=False, index=True),
            sa.Column("reason", sa.String(length=200), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("comment_id", "ip_key", name="uq_comment_flags_comment_ip"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("comment_flags")
