"""add post_revisions table for per-post version history (DEC-158, TASK-191)

Immutable snapshots of a post's editable fields, captured on every admin
create/update and before a restore. Additive table; no existing DDL is touched
(DEC-009). The post_id column is a plain integer (indexed) with ORM-level
cascade, matching the project's SQLite-safe additive-table convention.

Revision ID: g7a3b5c9e1d2f
Revises: f5d2a4b3c6e8
Create Date: 2026-08-23 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g7a3b5c9e1d2f"
down_revision: str | Sequence[str] | None = "f5d2a4b3c6e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("post_revisions"):
        op.create_table(
            "post_revisions",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("post_id", sa.Integer(), nullable=False, index=True),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("slug", sa.String(length=200), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("excerpt", sa.String(length=500), nullable=True),
            sa.Column("cover_image", sa.String(length=500), nullable=True),
            sa.Column("category_id", sa.Integer(), nullable=True),
            sa.Column("series_id", sa.Integer(), nullable=True),
            sa.Column("series_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("publish_at", sa.DateTime(), nullable=True),
            sa.Column("pinned", sa.Boolean(), nullable=True),
            sa.Column("published", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True, index=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("post_revisions")
