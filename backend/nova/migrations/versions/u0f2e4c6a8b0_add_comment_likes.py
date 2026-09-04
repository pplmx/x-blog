"""add comment_likes table for server-side like idempotency (security review)

Comment likes were a client-guarded count++ (browser localStorage dedup only),
so a determined caller could inflate a comment's likes to skew the "most
helpful" ordering — contradicting the idempotency hardening applied to flags.
This additive table mirrors comment_flags: one row per (comment, ip_key) so a
visitor likes a comment at most once and the count means distinct supporters.
Only the new table is added — no existing DDL is touched (DEC-009).

Revision ID: u0f2e4c6a8b0
Revises: t8e4g6a8c0e2
Create Date: 2026-09-04 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "u0f2e4c6a8b0"
down_revision: str | Sequence[str] | None = "t8e4g6a8c0e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("comment_likes"):
        op.create_table(
            "comment_likes",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("comment_id", sa.Integer(), nullable=False, index=True),
            sa.Column("ip_key", sa.String(length=50), nullable=False, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("comment_id", "ip_key", name="uq_comment_likes_comment_ip"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("comment_likes"):
        op.drop_table("comment_likes")
