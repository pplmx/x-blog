"""add reader_accounts.public_bookmarks (opt-in public saved-posts tab, round 363)

A reader's bookmarks are what they deliberately chose to save (an intentional
signal, unlike passively auto-recorded reading history); this additive column
is their opt-in switch to publish a public "Saved posts" tab on their profile
for anyone to browse (DEC-399). DEC-009-clean: a flat additive boolean on an
existing table, no DB-level FK, guarded by table/column probes so it is
idempotent on both SQLite and Postgres. Defaults OFF (sa.false(), THE dialect-
safe form — never the literal "false", which on SQLite would store TEXT that
bool() reads back as True) so existing readers — and anyone who never touches
the setting — stay perfectly private. Mirrors the round-360 public_likes
column byte for byte.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "i2k4m6n8p0r2"
down_revision: str | Sequence[str] | None = "g1h3i5k7m9n1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    """Column names of a table as a set (avoids reflection noise)."""
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    # `and` short-circuits: the column probe only runs when the table exists.
    if sa.inspect(op.get_bind()).has_table("reader_accounts") and "public_bookmarks" not in _cols("reader_accounts"):
        op.add_column(
            "reader_accounts",
            sa.Column("public_bookmarks", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("reader_accounts") and "public_bookmarks" in _cols("reader_accounts"):
        op.drop_column("reader_accounts", "public_bookmarks")
