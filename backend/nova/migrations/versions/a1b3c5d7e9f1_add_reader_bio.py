"""add reader_accounts.bio (round 352)

A simple additive TEXT column — no touch to existing columns, so the
SQLite-can't-add-FK constraint of DEC-009 does not apply. Nullable, backfilled
as NULL (existing readers have no bio until they write one).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b3c5d7e9f1"
down_revision: str | Sequence[str] | None = "z7d2c4e6f8a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("reader_accounts") and "bio" not in _cols("reader_accounts"):
        op.add_column("reader_accounts", sa.Column("bio", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("reader_accounts") and "bio" in _cols("reader_accounts"):
        op.drop_column("reader_accounts", "bio")
