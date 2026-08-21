"""add push_subscriptions.want_new_posts / new_post_category_id (DEC-076)

Readers who opt into new-post notifications get a Web Push when the author
publishes; ``new_post_category_id`` narrows that to a single followed category
(null = all new posts).

Entirely additive. No DB-level FOREIGN KEY on the category column (SQLite
alembic can't add an FK-carrying column to an existing table, DEC-009);
integrity (unknown category id) is enforced at the API layer. Defensive: each
piece is created only if absent (create_all-era dev DBs already carry the
columns via the model).

Revision ID: a1f9c3e5b7d2
Revises: e1f2a3b4c5d6
Create Date: 2026-08-21 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1f9c3e5b7d2"
down_revision: str | Sequence[str] | None = "e1f2a3b4c5d6"
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
    if "want_new_posts" not in columns:
        op.add_column(
            "push_subscriptions",
            sa.Column("want_new_posts", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )
    if "new_post_category_id" not in columns:
        op.add_column(
            "push_subscriptions",
            sa.Column("new_post_category_id", sa.Integer(), nullable=True),
        )
        op.create_index(
            op.f("ix_push_subscriptions_new_post_category_id"),
            "push_subscriptions",
            ["new_post_category_id"],
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    if sa.inspect(bind).has_table("push_subscriptions"):
        columns = _subs_columns(bind)
        if "new_post_category_id" in columns:
            op.drop_index(
                op.f("ix_push_subscriptions_new_post_category_id"),
                table_name="push_subscriptions",
                if_exists=True,
            )
            op.drop_column("push_subscriptions", "new_post_category_id")
        if "want_new_posts" in columns:
            op.drop_column("push_subscriptions", "want_new_posts")
