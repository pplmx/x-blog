"""add is_author_reply to comments

Revision ID: o4a1b2c3d4e5
Revises: n3f8b0d2e4a6
Create Date: 2026-08-26 00:00:00.000000

Author replies from the moderation queue (DEC-192, TASK-212): an admin
answering a commenter is stored like any comment but flagged is_author_reply
so the public thread can render the "author" badge. Additive boolean with a
server default of False — existing comment rows read non-nullable-safe.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "o4a1b2c3d4e5"
down_revision: str | Sequence[str] | None = "n3f8b0d2e4a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "comments",
        sa.Column("is_author_reply", sa.Boolean(), nullable=True, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("comments", "is_author_reply")
