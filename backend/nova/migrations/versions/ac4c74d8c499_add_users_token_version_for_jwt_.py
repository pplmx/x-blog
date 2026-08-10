"""add users.token_version for JWT revocation

Adds ``users.token_version`` (default 0) so a password change can bump it and
invalidate every previously signed JWT (checked in app/auth.get_current_user).

Defensive like the round-13 baseline: if the column already exists (a dev DB
whose create_all safety net already created it before this migration ran), the
column is left as-is and only the version is stamped — no duplicate-column
error on adoption. (RIL round 16 security audit)

Revision ID: ac4c74d8c499
Revises: 1e0bb4163cc8
Create Date: 2026-08-10 09:05:42.700679

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "ac4c74d8c499"
down_revision: str | Sequence[str] | None = "1e0bb4163cc8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    existing = {col["name"] for col in sa.inspect(bind).get_columns("users")}
    if "token_version" not in existing:
        op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "token_version")
