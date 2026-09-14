"""add newsletter_subscribers table (DEC-351, TASK-401).

A brand-new additive table only — no existing table is touched, so the
SQLite-can't-add-FK constraint of DEC-009 does not apply. The table holds
guest email addresses opted into the "email me new posts" newsletter, with a
per-subscriber opaque token for confirm/unsubscribe links (mirroring
Comment.reply_notify_token, DEC-332) and a defensive ``is_confirmed`` double
opt-in flag. ``email`` is unique at the DB level so a concurrent resubscribe
can never create a duplicate row.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "k4f6a8c0e2d4"
down_revision: str | Sequence[str] | None = "j3f5a7c9e1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("newsletter_subscribers"):
        op.create_table(
            "newsletter_subscribers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("email", sa.String(length=254), nullable=False),
            sa.Column("token", sa.String(length=64), nullable=False),
            sa.Column(
                "is_confirmed",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=True,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
        )
        op.create_index("ix_newsletter_subscribers_email", "newsletter_subscribers", ["email"], unique=True)
        op.create_index("ix_newsletter_subscribers_id", "newsletter_subscribers", ["id"])
        op.create_index("ix_newsletter_subscribers_created_at", "newsletter_subscribers", ["created_at"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("newsletter_subscribers"):
        op.drop_table("newsletter_subscribers")
