"""add reader email-change verification columns (DEC-357, TASK-404).

``email_change_pending`` (the NEW address, proven by an emailed link),
``email_change_token`` (opaque one-time secret the link carries; unique so no
two accounts can share a pending change) and ``email_change_requested_at``
(expiry clock, 60-minute TTL). Pure additive columns on the existing
reader_accounts table; no data change. DEC-009 additive style with idempotent
has_column guards so re-applying is a no-op.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "o5f7a9c1e3d5"
down_revision: str | Sequence[str] | None = "n3e5f7a9b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    if sa.inspect(op.get_bind()).has_table("reader_accounts"):
        cols = _columns("reader_accounts")
        if "email_change_pending" not in cols:
            op.add_column("reader_accounts", sa.Column("email_change_pending", sa.String(254), nullable=True))
        if "email_change_token" not in cols:
            op.add_column("reader_accounts", sa.Column("email_change_token", sa.String(64), nullable=True))
        if "email_change_requested_at" not in cols:
            op.add_column("reader_accounts", sa.Column("email_change_requested_at", sa.DateTime(), nullable=True))
        ix = "ix_reader_accounts_email_change_token"
        indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("reader_accounts")}
        if ix not in indexes:
            op.create_index(ix, "reader_accounts", ["email_change_token"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("reader_accounts"):
        ix = "ix_reader_accounts_email_change_token"
        indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("reader_accounts")}
        if ix in indexes:
            op.drop_index(ix, table_name="reader_accounts")
        cols = _columns("reader_accounts")
        for col in ("email_change_requested_at", "email_change_token", "email_change_pending"):
            if col in cols:
                op.drop_column("reader_accounts", col)
