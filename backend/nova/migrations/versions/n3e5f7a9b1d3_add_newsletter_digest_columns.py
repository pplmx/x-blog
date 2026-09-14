"""add newsletter digest cadence columns (DEC-355, TASK-403).

``digest_weekly`` (opt-in weekly digest instead of per-post mail; server
default false preserves today's per-post behavior for existing rows) and
``digest_sent_at`` (the idempotency stamp of the guest digest job, mirroring
ReaderNotificationPref.digest_sent_at). Pure additive columns on the existing
newsletter_subscribers table; no data change. DEC-009 additive style with
idempotent has_column guards so re-applying is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "n3e5f7a9b1d3"
down_revision: str | Sequence[str] | None = "l5c7e9b1d3f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    if sa.inspect(op.get_bind()).has_table("newsletter_subscribers"):
        cols = _columns("newsletter_subscribers")
        if "digest_weekly" not in cols:
            op.add_column(
                "newsletter_subscribers",
                sa.Column("digest_weekly", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            )
        if "digest_sent_at" not in cols:
            op.add_column(
                "newsletter_subscribers",
                sa.Column("digest_sent_at", sa.DateTime(), nullable=True),
            )


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("newsletter_subscribers"):
        cols = _columns("newsletter_subscribers")
        if "digest_sent_at" in cols:
            op.drop_column("newsletter_subscribers", "digest_sent_at")
        if "digest_weekly" in cols:
            op.drop_column("newsletter_subscribers", "digest_weekly")
