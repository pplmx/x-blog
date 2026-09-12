"""add avatar_url to reader_accounts (reader profile picture)

Reader-identity wave (DEC-294, reader profiles) made a commenter's display name
linkable, but the identity is text-only: there is no picture anywhere in the
system. A reader-set avatar (a small profile photo served from /static/avatars,
uploaded through a reader-scoped endpoint) makes the same identity visible in
the comment list and on the public profile page - the natural completion of the
identity slice.

This additive nullable column follows DEC-009: no existing DDL is touched, and
existing rows simply carry a NULL avatar_url (rendered as a placeholder).

Revision ID: v1a3b5c7d9e1
Revises: u0f2e4c6a8b0
Create Date: 2026-09-12 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "v1a3b5c7d9e1"
down_revision: str | Sequence[str] | None = "u0f2e4c6a8b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_accounts"):
        return
    columns = {c["name"] for c in sa.inspect(bind).get_columns("reader_accounts")}
    if "avatar_url" not in columns:
        op.add_column(
            "reader_accounts",
            sa.Column("avatar_url", sa.String(length=255), nullable=True),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("reader_accounts"):
        columns = {c["name"] for c in sa.inspect(bind).get_columns("reader_accounts")}
        if "avatar_url" in columns:
            op.drop_column("reader_accounts", "avatar_url")
