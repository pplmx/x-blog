"""add reading_history.scroll_position for per-post resume (DEC-167)

A signed-in reader's reading-history row gains a nullable ``scroll_position``
pixel offset so a returning reader can be dropped back where they left off
inside a post. Entirely additive — no FK, no constraint changes, matching
DEC-009's additive-column convention (plain nullable column; integrity enforced
at the API layer like the other reading-history fields).

Revision ID: j9c5e7d1f3b4
Revises: h8b4c6d8f0a2
Create Date: 2026-08-24 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j9c5e7d1f3b4"
down_revision: str | Sequence[str] | None = "h8b4c6d8f0a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _history_columns(bind) -> set[str]:
    """Existing column names on the reading_history table."""
    return {c["name"] for c in sa.inspect(bind).get_columns("reading_history")}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("reading_history"):
        # Nothing to add on a fresh DB — create_all builds the full model.
        return

    columns = _history_columns(bind)
    if "scroll_position" not in columns:
        op.add_column("reading_history", sa.Column("scroll_position", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    if sa.inspect(bind).has_table("reading_history"):
        columns = _history_columns(bind)
        if "scroll_position" in columns:
            op.drop_column("reading_history", "scroll_position")
