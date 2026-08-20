"""add push_subscriptions.reader_id for targeted reader notifications (DEC-064)

Adds a nullable ``reader_id`` column to ``push_subscriptions`` binding a
subscription to the reader account that created it, so notifications can be
targeted to a specific reader (e.g. "someone replied to your comment").

No DB-level FOREIGN KEY (SQLite alembic can't add an FK-carrying column to an
existing table, DEC-009); integrity is enforced at the ORM layer. Entirely
additive — no existing DDL touched. Defensive: if the column already exists
(create_all-era dev DB), each missing piece is created only if absent.

Revision ID: d9e8f7a6b5c4
Revises: c7d8e9f0a1b2
Create Date: 2026-08-20 08:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9e8f7a6b5c4"
down_revision: str | Sequence[str] | None = "c7d8e9f0a1b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _subs_columns(bind) -> set[str]:
    """Existing column names on the push_subscriptions table."""
    return {c["name"] for c in sa.inspect(bind).get_columns("push_subscriptions")}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("push_subscriptions"):
        # Nothing to add on a fresh DB — create_all builds the full model.
        return

    columns = _subs_columns(bind)
    if "reader_id" not in columns:
        op.add_column(
            "push_subscriptions",
            sa.Column("reader_id", sa.Integer(), nullable=True),
        )
        op.create_index(op.f("ix_push_subscriptions_reader_id"), "push_subscriptions", ["reader_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    if sa.inspect(bind).has_table("push_subscriptions"):
        columns = _subs_columns(bind)
        if "reader_id" in columns:
            op.drop_index(op.f("ix_push_subscriptions_reader_id"), table_name="push_subscriptions", if_exists=True)
            op.drop_column("push_subscriptions", "reader_id")
