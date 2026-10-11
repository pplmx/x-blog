"""add_reader_highlights

Revision ID: 9b8c7d6e5f4a
Revises: a8c9d0e1f2a3
Create Date: 2026-10-12 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9b8c7d6e5f4a"
down_revision: str | Sequence[str] | None = "a8c9d0e1f2a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "reader_highlights",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("reader_id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reader_id", "post_id", "text", name="uq_reader_highlights_reader_post_text"),
    )
    op.create_index("ix_reader_highlights_id", "reader_highlights", ["id"])
    op.create_index("ix_reader_highlights_reader_id", "reader_highlights", ["reader_id"])
    op.create_index("ix_reader_highlights_post_id", "reader_highlights", ["post_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_reader_highlights_post_id", table_name="reader_highlights")
    op.drop_index("ix_reader_highlights_reader_id", table_name="reader_highlights")
    op.drop_index("ix_reader_highlights_id", table_name="reader_highlights")
    op.drop_table("reader_highlights")
