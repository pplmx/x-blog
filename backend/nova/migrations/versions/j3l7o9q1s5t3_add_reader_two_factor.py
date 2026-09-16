"""add reader_accounts two-factor columns (TOTP 2FA, round 364)

Reader accounts guard durable private data (cloud-synced bookmarks/likes/
history, GDPR export) behind a single password; these two additive columns let
a reader raise that to password + a TOTP code (RFC 6238, any authenticator
app). DEC-009-clean: two flat additive columns on an existing table, no DB-level
FK, guarded by table/column probes so both are idempotent on SQLite and
Postgres. two_factor_enabled defaults OFF via sa.false() — THE dialect-safe
form (never the literal "false", which on SQLite stores TEXT that bool() reads
back as True) — so existing readers stay single-step until they enroll. The
base32 seed column is nullable (most readers never enable 2FA; NULL = not
enrolled and not mid-enrollment).

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "j3l7o9q1s5t3"
down_revision: str | Sequence[str] | None = "i2k4m6n8p0r2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    """Column names of a table as a set (avoids reflection noise)."""
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    if not sa.inspect(op.get_bind()).has_table("reader_accounts"):
        return
    cols = _cols("reader_accounts")
    if "two_factor_secret" not in cols:
        op.add_column(
            "reader_accounts",
            sa.Column("two_factor_secret", sa.String(length=64), nullable=True),
        )
    if "two_factor_enabled" not in cols:
        op.add_column(
            "reader_accounts",
            sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if not sa.inspect(op.get_bind()).has_table("reader_accounts"):
        return
    cols = _cols("reader_accounts")
    if "two_factor_enabled" in cols:
        op.drop_column("reader_accounts", "two_factor_enabled")
    if "two_factor_secret" in cols:
        op.drop_column("reader_accounts", "two_factor_secret")
