"""add reader_accounts.is_active + last_login_at for admin reader moderation (DEC-194, TASK-214, ISS-116)

The reader-accounts arc (DEC-059 onward) shipped reader-facing self-service
(register, login, profile, bookmarks, comment history, self-deletion) but no
operator surface: the blog owner cannot see registered readers nor stop one.
``is_active`` is the moderation switch — a deactivated reader is blocked at
login (reader.py), rejected by get_current_reader, and resolved to anonymous
by get_optional_reader, so the trust-tier auto-approve (DEC-098) path cannot be
gamed through a deactivated account. ``last_login_at`` gives the admin readers
list a usable activity signal. Both columns are additive, existing rows default
to active (server_default true / NULL), no existing DDL is touched (DEC-009).

Revision ID: p7d2e4f6a8b0
Revises: o4a1b2c3d4e5
Create Date: 2026-08-27 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p7d2e4f6a8b0"
down_revision: str | Sequence[str] | None = "o4a1b2c3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_accounts"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_accounts")}
    if "is_active" not in cols:
        op.add_column(
            "reader_accounts",
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        )
    if "last_login_at" not in cols:
        op.add_column("reader_accounts", sa.Column("last_login_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_accounts"):
        return
    cols = {c["name"] for c in sa.inspect(bind).get_columns("reader_accounts")}
    if "last_login_at" in cols:
        op.drop_column("reader_accounts", "last_login_at")
    if "is_active" in cols:
        op.drop_column("reader_accounts", "is_active")
