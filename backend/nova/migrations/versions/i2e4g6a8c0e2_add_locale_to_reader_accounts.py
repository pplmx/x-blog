"""add reader `locale` to reader_accounts (DEC-338, TASK-395).

Notification copy was hardcoded Chinese for every reader (inbox titles,
per-event emails, weekly digest) regardless of UI language or site_language.
The `locale` column stores the reader's chosen language (frontend codes "en"/
"zh"); NULL reads as the site default (zh), so existing readers keep today's
copy. Additive (DEC-009); no existing column is touched and existing rows stay
NULL.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "i2e4g6a8c0e2"
down_revision: str | Sequence[str] | None = "h1d2f4a6c8e0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_accounts"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_accounts")}
    if "locale" not in cols:
        op.add_column("reader_accounts", sa.Column("locale", sa.String(length=8), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_accounts"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_accounts")}
    if "locale" in cols:
        op.drop_column("reader_accounts", "locale")
