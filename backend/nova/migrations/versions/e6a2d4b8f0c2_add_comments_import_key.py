"""add comments.import_key for idempotent backup restore (DEC-082)

Full-blog restore (POST /api/admin/backup/restore) upserts posts by slug but
comments have no natural key, so a second import of the same snapshot would
duplicate them. ``import_key`` (nullable, "{post_slug}#{export-ordinal}") is
the idempotency anchor: restore looks up (post_id, import_key) and skips rows
already present.

Entirely additive (new nullable column, no existing DDL touched, DEC-009
preserved). Defensive like earlier column-adds: if the column already exists
(a dev DB whose create_all-era safety net already added it), it is left as-is
and only the version is stamped.

Revision ID: e6a2d4b8f0c2
Revises: c9a1b3d5e7f1
Create Date: 2026-08-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e6a2d4b8f0c2"
down_revision: str | Sequence[str] | None = "c9a1b3d5e7f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    existing = {col["name"] for col in sa.inspect(bind).get_columns("comments")}
    if "import_key" not in existing:
        op.add_column(
            "comments",
            sa.Column("import_key", sa.String(length=100), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("comments", "import_key")
