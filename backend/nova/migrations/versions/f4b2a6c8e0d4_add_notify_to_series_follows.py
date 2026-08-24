"""add notify column to series_follows (DEC-138, TASK-181)

Per-series follow now decouples *tracking* from *push*: a follow with
notify=false still shows in the reader's "Your series" row and followed-series
list but is not fanned out in new-part push dispatch. Adds an additive,
non-null column defaulting to true (existing rows keep notifications on).
No existing DDL is touched (DEC-009).

Revision ID: f4b2a6c8e0d4
Revises: f2a4c6e8d0b2
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4b2a6c8e0d4"
down_revision: str | Sequence[str] | None = "f2a4c6e8d0b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("series_follows"):
        cols = {c["name"] for c in sa.inspect(bind).get_columns("series_follows")}
        if "notify" not in cols:
            op.add_column(
                "series_follows",
                sa.Column(
                    "notify",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.true(),
                ),
            )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("series_follows", "notify")
