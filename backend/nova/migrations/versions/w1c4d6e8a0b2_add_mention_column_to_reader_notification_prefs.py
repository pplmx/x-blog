"""add mention column to reader_notification_prefs (DEC-322, TASK-389).

The @-mention fan-out (an approved comment names a reader's display name as
@<name>) adds a new notification *kind*. ReaderNotificationPref holds one bool
per kind, so this is one additive column (DEC-009) — on by default like
new_post/reply/thread_comment, so a reader who never opened the preferences
surface keeps receiving mentions.

Additive only, and defensively skipped if already present.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "w1c4d6e8a0b2"
down_revision: str | Sequence[str] | None = "v1a3b5c7d9e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    if "mention" not in cols:
        op.add_column(
            "reader_notification_prefs",
            sa.Column("mention", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    if "mention" in cols:
        op.drop_column("reader_notification_prefs", "mention")
