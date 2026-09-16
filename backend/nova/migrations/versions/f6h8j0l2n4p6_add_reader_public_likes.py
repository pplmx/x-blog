"""add reader_accounts.public_likes (opt-in public liked-posts tab, round 360)

A reader's likes of posts are private taste (round 359); this additive column
is their opt-in switch to publish a public "Liked posts" tab on their profile
for anyone to browse (DEC-393). DEC-009-clean: a flat additive boolean on an
existing table, no DB-level FK, guarded by table/column probes so it is
idempotent on both SQLite and Postgres. Defaults OFF (server_default "false")
so existing readers — and anyone who never touches the setting — stay
perfectly private.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6h8j0l2n4p6"
down_revision: str | Sequence[str] | None = "e5g7i9k1m3o5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    """Column names of a table as a set (avoids reflection noise)."""
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    # `and` short-circuits: the column probe only runs when the table exists.
    if sa.inspect(op.get_bind()).has_table("reader_accounts") and "public_likes" not in _cols("reader_accounts"):
        op.add_column(
            "reader_accounts",
            sa.Column("public_likes", sa.Boolean(), nullable=False, server_default="false"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("reader_accounts") and "public_likes" in _cols("reader_accounts"):
        op.drop_column("reader_accounts", "public_likes")
