"""add scroll_fraction to reading_history (DEC-346, TASK-399).

Resume reading (DEC-167) stores an absolute scroll pixel offset that is
viewport-dependent — a phone->desktop continuation lands at the wrong place.
The ``scroll_fraction`` column stores the same position as a 0..1 fraction of
the scrollable document height so the client can restore proportionally on any
viewport; NULL means "saved before this feature", and the client falls back to
the stored pixel. Additive (DEC-009); no existing column is touched and
existing rows start NULL.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j3f5a7c9e1d3"
down_revision: str | Sequence[str] | None = "i2e4g6a8c0e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reading_history"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reading_history")}
    if "scroll_fraction" not in cols:
        op.add_column("reading_history", sa.Column("scroll_fraction", sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reading_history"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reading_history")}
    if "scroll_fraction" in cols:
        op.drop_column("reading_history", "scroll_fraction")
