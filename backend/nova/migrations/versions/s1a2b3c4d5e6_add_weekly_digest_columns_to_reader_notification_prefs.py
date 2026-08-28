"""add weekly-digest columns to reader_notification_prefs (DEC-201, TASK-222).

The email channel (DEC-197/198, r7e3f5a8b0c2) delivers *per-event* copies of
the notification fan-out. This adds the second, recurring email surface: an
opt-in weekly digest — one aggregated HTML email per reader summarizing the
week's public posts. It is a fresh opt-in (email_weekly_digest, off by default
so nothing changes unless a reader switches it on) plus a nullable marker
(digest_sent_at) the job uses for idempotency/window tracking.

Additive columns only (DEC-009) — the reader_notification_prefs table already
exists, so like its email-channel predecessor this adds columns rather than a
new table, defensively skipping any that are already present.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "s1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "r7e3f5a8b0c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    if "email_weekly_digest" not in cols:
        op.add_column(
            "reader_notification_prefs",
            sa.Column("email_weekly_digest", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if "digest_sent_at" not in cols:
        op.add_column("reader_notification_prefs", sa.Column("digest_sent_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_notification_prefs"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_notification_prefs")}
    for name in ("email_weekly_digest", "digest_sent_at"):
        if name in cols:
            op.drop_column("reader_notification_prefs", name)
