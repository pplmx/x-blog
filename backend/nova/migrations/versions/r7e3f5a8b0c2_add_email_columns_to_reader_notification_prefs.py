"""add email_* opt-in columns to reader_notification_prefs (DEC-197, TASK-217).

The reader notification arc (DEC-160/171/195) delivered the inbox + browser push.
This adds the third, opt-in channel: a per-kind email copy of the fan-out,
delivered over SMTP. Email is off by default for every reader (server_default
false) so nothing changes unless a reader turns a kind's email toggle on.

Additive columns only (DEC-009) — the reader_notification_prefs table already
exists, so like the reader moderation columns (p7d2e4f6a8b0) this adds columns
rather than a new table, defensively skipping any that are already present.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "r7e3f5a8b0c2"
down_revision: str | Sequence[str] | None = "q6c9d1e3a5b7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EMAIL_COLUMNS: tuple[str, ...] = ("email_new_post", "email_reply", "email_thread_comment")


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    for name in _EMAIL_COLUMNS:
        if name not in cols:
            op.add_column(
                "reader_notification_prefs",
                sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.text("false")),
            )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    for name in _EMAIL_COLUMNS:
        if name in cols:
            op.drop_column("reader_notification_prefs", name)
