"""add unsubscribed_at to guest_comment_subscriptions (TASK-485, ISSUE-561)

The guest comment-thread follow had a consent-restart gap the newsletter
closed in round 393 (NewsletterSubscriber.unsubscribed_at): unsubscribing only
flipped is_confirmed=False, so replaying the ORIGINAL double-opt-in
confirmation link silently re-subscribed the address with no fresh opt-in
email. One additive nullable column (DEC-009) lets the confirm gate refuse an
unsubscribed address (400 "please subscribe again") and lets a re-subscribe
rotate the token + send a fresh double-opt-in. Additive only; defensively
skipped if already present.

Revision ID: n3p5r7t9v1x3
Revises: k9d2e4f6a8b1
Create Date: 2026-09-21 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "n3p5r7t9v1x3"
down_revision: str | Sequence[str] | None = "k9d2e4f6a8b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("guest_comment_subscriptions"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("guest_comment_subscriptions")}
    if "unsubscribed_at" not in cols:
        op.add_column(
            "guest_comment_subscriptions",
            sa.Column("unsubscribed_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("guest_comment_subscriptions"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("guest_comment_subscriptions")}
    if "unsubscribed_at" in cols:
        op.drop_column("guest_comment_subscriptions", "unsubscribed_at")
