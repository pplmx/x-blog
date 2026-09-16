"""add reader_bookmarks.done (read-later vs done queue state, round 361)

/bookmarks conflation fix: a saved post is either still in the To-read queue
or already read / kept around. This additive boolean is the queue marker
(DEC-395) alongside the existing folder classification — DEC-009-clean: a
flat additive boolean on an existing table, no DB-level FK, guarded by
table/column probes so it is idempotent on both SQLite and Postgres. Defaults
OFF (server_default "false") so every existing bookmark reads as To-read
until its reader explicitly marks it Done.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g1h3i5k7m9n1"
down_revision: str | Sequence[str] | None = "f6h8j0l2n4p6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    """Column names of a table as a set (avoids reflection noise)."""
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    # `and` short-circuits: the column probe only runs when the table exists.
    if sa.inspect(op.get_bind()).has_table("reader_bookmarks") and "done" not in _cols("reader_bookmarks"):
        # sa.false() (NOT the literal "false") — on SQLite the string form would
        # compile to DEFAULT 'false', storing TEXT that bool() reads back as True
        # and the integer-bound .is_() filter never matches (found by review).
        op.add_column(
            "reader_bookmarks",
            sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("reader_bookmarks") and "done" in _cols("reader_bookmarks"):
        op.drop_column("reader_bookmarks", "done")
