"""add guest reply-notify consent columns to comments (DEC-332, TASK-392).

The comment form requires an anonymous commenter to leave an email and it is
stored on the comment row, but no dispatch path ever used it (the reply-notify
guard was `parent.reader_id is not None`), so replies to anonymous comments
reached nobody. DEC-332 adds a best-effort email to the guest's own address
when a reply to their comment is approved — gated on explicit consent plus a
per-comment unsubscribe token. Both are additive (DEC-009); no existing column
is touched. Defender defaults keep the channel strictly opt-in.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g6c8e0a2d4f6"
down_revision: str | Sequence[str] | None = "w2d4e6f8a0b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("comments"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("comments")}
    if "reply_notify_email" not in cols:
        op.add_column(
            "comments",
            sa.Column("reply_notify_email", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if "reply_notify_token" not in cols:
        op.add_column("comments", sa.Column("reply_notify_token", sa.String(length=64), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("comments"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("comments")}
    if "reply_notify_token" in cols:
        op.drop_column("comments", "reply_notify_token")
    if "reply_notify_email" in cols:
        op.drop_column("comments", "reply_notify_email")
