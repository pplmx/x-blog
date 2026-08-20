"""add comments.reviewed_at to distinguish pending from rejected (DEC-066)

Comments toggle ``is_approved`` on both routes (approved / rejected) but the
author's history needs a treble status (pending / approved / rejected). A
nullable ``reviewed_at`` records the last moderator action: null => pending,
non-null => rejected (if not approved) or approved. Entirely additive.

No DB-level constraints beyond what exists (plain nullable column, no FK),
matching DEC-009's additive-column convention.

Revision ID: e1f2a3b4c5d6
Revises: d9e8f7a6b5c4
Create Date: 2026-08-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1f2a3b4c5d6"
down_revision: str | Sequence[str] | None = "d9e8f7a6b5c4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _comments_columns(bind) -> set[str]:
    """Existing column names on the comments table."""
    return {c["name"] for c in sa.inspect(bind).get_columns("comments")}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("comments"):
        # Nothing to add on a fresh DB — create_all builds the full model.
        return

    columns = _comments_columns(bind)
    if "reviewed_at" not in columns:
        op.add_column("comments", sa.Column("reviewed_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    if sa.inspect(bind).has_table("comments"):
        columns = _comments_columns(bind)
        if "reviewed_at" in columns:
            op.drop_column("comments", "reviewed_at")
