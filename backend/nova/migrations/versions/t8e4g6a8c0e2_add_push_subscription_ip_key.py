"""add ip_key to push_subscriptions for anonymous per-IP caps (security review)

Anonymous subscribe rows (reader_id NULL) previously carried no client
identity, so the table could grow without a per-source bound and the (serial)
dispatch loop could be amplified. This additive nullable column stamps the
request's client rate-limit key on anonymous rows only — signed-in rows keep
reader_id as their identity and leave ip_key NULL. Only the new column is
touched, no existing DDL (DEC-009); the column is nullable+indexed and safely
skipped if already present.

Revision ID: t8e4g6a8c0e2
Revises: s1a2b3c4d5e6
Create Date: 2026-09-04 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "t8e4g6a8c0e2"
down_revision: str | Sequence[str] | None = "s1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("push_subscriptions"):
        return
    columns = {c["name"] for c in sa.inspect(bind).get_columns("push_subscriptions")}
    if "ip_key" not in columns:
        op.add_column(
            "push_subscriptions",
            sa.Column("ip_key", sa.String(length=50), nullable=True),
        )
        op.create_index("ix_push_subscriptions_ip_key", "push_subscriptions", ["ip_key"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("push_subscriptions"):
        op.drop_index("ix_push_subscriptions_ip_key", table_name="push_subscriptions")
        op.drop_column("push_subscriptions", "ip_key")
