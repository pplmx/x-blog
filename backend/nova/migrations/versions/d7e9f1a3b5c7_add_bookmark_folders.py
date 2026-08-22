"""add bookmark_folders table + folder_id on reader_bookmarks (DEC-120)

Signed-in readers can organize saved posts into folders. Adds the new
additive ``bookmark_folders`` table and a nullable ``folder_id`` column on the
existing ``reader_bookmarks`` table (both additive, no existing DDL mutated —
DEC-009). No DB-level FK on the new column (SQLite alembic can't add
FK-carrying columns to existing tables); ownership is enforced at the API
layer like the other reader-owned resources.

Revision ID: d7e9f1a3b5c7
Revises: c3d5e7f9a0b1
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7e9f1a3b5c7"
down_revision: str | Sequence[str] | None = "c3d5e7f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("bookmark_folders"):
        op.create_table(
            "bookmark_folders",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("name", sa.String(length=50), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "name", name="uq_bookmark_folders_reader_name"),
        )
    # Add the nullable folder_id column to the existing reader_bookmarks table
    # if not already present (additive ALTER TABLE — DEC-009).
    columns = {c["name"] for c in inspector.get_columns("reader_bookmarks")}
    if "folder_id" not in columns:
        op.add_column("reader_bookmarks", sa.Column("folder_id", sa.Integer(), nullable=True, index=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("reader_bookmarks", "folder_id")
    op.drop_table("bookmark_folders")
