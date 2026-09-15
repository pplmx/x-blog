"""add author_follows table (round 353)

A brand-new additive table — no existing table is touched, so the
SQLite-can't-add-FK constraint of DEC-009 does not apply. Holds the writer
follow subscriptions (reader_id, author_id) that fan out new-post
notifications for a specific pen-named author, with a DB-level unique on
(reader_id, author_id) so a reader can never follow the same writer twice.
``author_id`` is a plain integer (no FK) following the repo's additive
convention; ``notify`` mirrors CategoryFollow/SeriesFollow.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c4d6e8f0a2"
down_revision: str | Sequence[str] | None = "a1b3c5d7e9f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("author_follows"):
        op.create_table(
            "author_follows",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("reader_id", sa.Integer(), nullable=False),
            sa.Column("author_id", sa.Integer(), nullable=False),
            sa.Column(
                "notify",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint(
                "reader_id", "author_id", name="uq_author_follows_reader_author"
            ),
        )
        op.create_index("ix_author_follows_id", "author_follows", ["id"])
        op.create_index("ix_author_follows_reader_id", "author_follows", ["reader_id"])
        op.create_index("ix_author_follows_author_id", "author_follows", ["author_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("author_follows"):
        op.drop_table("author_follows")
