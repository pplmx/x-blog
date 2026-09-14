"""add new_post_notified_at stamp to posts (DEC-336, TASK-394).

A post created as published-but-future ``publish_at`` becomes publicly visible
when the clock crosses it, but the write-time new-post fan-out ran when
visibility was still False (and update_post only fires on a draft->visible
transition), so scheduled posts could reach readers without ever notifying
followers. ``maybe_notify_due_scheduled_posts`` (fire-on-read sweep) claims
each crossed-but-unannounced post exactly once using a durable
``new_post_notified_at`` timestamp: NULL until the post is announced, then set
atomically so no sweep or write-time path double-fires. Additive (DEC-009);
no existing column is touched and existing rows start NULL (pre-existing
scheduled posts that already crossed are retroactively claimable on their next
public read).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "h1d2f4a6c8e0"
down_revision: str | Sequence[str] | None = "g6c8e0a2d4f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("posts"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("posts")}
    if "new_post_notified_at" not in cols:
        op.add_column("posts", sa.Column("new_post_notified_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("posts"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("posts")}
    if "new_post_notified_at" in cols:
        op.drop_column("posts", "new_post_notified_at")
