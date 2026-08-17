"""add users.role for role-tier admin (DEC-054)

Adds ``users.role`` (superuser|editor) as the authoritative admin discriminator.
Existing rows are backfilled from ``users.is_superuser``: superusers keep the
``superuser`` role; non-superuser accounts (previously unusable for any admin
endpoint) become ``editor`` so they can moderate content (ISS-087, TASK-107).

The ``is_superuser`` boolean column is preserved (DDL kept, DEC-009) and stays
consistent with role at write sites. Defensive like the round-16 baseline: if
``role`` already exists (a dev DB whose create_all safety net already created it
before this migration ran), it is left as-is and only the version is stamped.

Revision ID: b3f7a1c9d054
Revises: ac4c74d8c499
Create Date: 2026-08-17 12:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3f7a1c9d054"
down_revision: str | Sequence[str] | None = "ac4c74d8c499"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    existing = {col["name"] for col in sa.inspect(bind).get_columns("users")}
    if "role" not in existing:
        op.add_column("users", sa.Column("role", sa.String(length=20), nullable=False, server_default="editor"))
        # Backfill: superusers keep superuser role; non-superusers become editors.
        op.execute("UPDATE users SET role='superuser' WHERE is_superuser = 1")


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "role")
