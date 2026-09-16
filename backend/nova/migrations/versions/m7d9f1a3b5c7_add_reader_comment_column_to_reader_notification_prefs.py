"""add reader_comment column to reader_notification_prefs (round 365, DEC-403).

Reader-to-reader follow (a signed-in reader follows another reader) adds a
durable inbox fan-out when the followed reader's comment is approved. Like the
@-mention kind (DEC-322) it is a *kind*, so ReaderNotificationPref needs one
bool per kind — one additive column (DEC-009), on by default, so a reader who
never opened the preferences surface keeps receiving followed-comment
notifications until they opt out.

Additive only, and defensively skipped if already present.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "m7d9f1a3b5c7"
down_revision: str | Sequence[str] | None = "l5n7p9r1t3v5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    if "reader_comment" not in cols:
        op.add_column(
            "reader_notification_prefs",
            sa.Column("reader_comment", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    if "reader_comment" in cols:
        op.drop_column("reader_notification_prefs", "reader_comment")
