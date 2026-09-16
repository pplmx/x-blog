"""add reader_follows table (reader-to-reader follow, round 365)

A brand-new additive table — no existing table is touched, so the
SQLite-can't-add-FK constraint of DEC-009 does not apply. Holds a reader's
follow subscriptions to OTHER READERS (reader_id, followed_id), the last
un-followable identity once authors/tags/series/categories had follow. A
DB-level unique on (reader_id, followed_id) stops a reader following the same
reader twice; ``followed_id`` is a plain integer (no FK) following the repo's
additive convention, and ``notify`` mirrors AuthorFollow/CategoryFollow.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "l5n7p9r1t3v5"
down_revision: str | Sequence[str] | None = "j3l7o9q1s5t3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_follows"):
        op.create_table(
            "reader_follows",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("reader_id", sa.Integer(), nullable=False),
            sa.Column("followed_id", sa.Integer(), nullable=False),
            sa.Column(
                "notify",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "followed_id", name="uq_reader_follows_reader_followed"),
        )
        op.create_index("ix_reader_follows_id", "reader_follows", ["id"])
        op.create_index("ix_reader_follows_reader_id", "reader_follows", ["reader_id"])
        op.create_index("ix_reader_follows_followed_id", "reader_follows", ["followed_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("reader_follows"):
        op.drop_table("reader_follows")
