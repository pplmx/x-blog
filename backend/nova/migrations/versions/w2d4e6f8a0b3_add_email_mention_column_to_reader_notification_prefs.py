"""add email_mention column to reader_notification_prefs (DEC-326, TASK-391).

The @-mention fan-out (DEC-322) gained an email channel: a reader who opted
into email notifications also gets the personal "someone named you" email
off-site. ReaderNotificationPref holds one bool per email kind, so this is one
additive column (DEC-009) — off by default like the other email_* columns, so
email stays strictly opt-in and a reader who never opened the preferences
surface receives nothing.

Additive only, and defensively skipped if already present.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "w2d4e6f8a0b3"
down_revision: str | Sequence[str] | None = "w1c4d6e8a0b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    if "email_mention" not in cols:
        op.add_column(
            "reader_notification_prefs",
            sa.Column("email_mention", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    if "email_mention" in cols:
        op.drop_column("reader_notification_prefs", "email_mention")
