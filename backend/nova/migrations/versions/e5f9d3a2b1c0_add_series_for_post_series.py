"""add series table and post series link for post series (DEC-056)

Adds a ``series`` table (title/slug/description) plus ``posts.series_id`` and
``posts.series_order`` so posts can be grouped into an author-ordered sequence
exposed as a public series page with in-series prev/next navigation.

Entirely additive: a new table plus two new nullable/defaulted columns on the
existing ``posts`` table — no existing DDL is touched (DEC-009 preserved).

Defensive like the push-subscriptions and role-tier migrations: if any piece
already exists (a dev DB whose create_all safety net created it first), it is
left as-is and only the missing pieces are created — no duplicate-table /
duplicate-column error on adoption.

Revision ID: e5f9d3a2b1c0
Revises: d4f8e2c1a0b6
Create Date: 2026-08-18 14:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f9d3a2b1c0"
down_revision: str | Sequence[str] | None = "d4f8e2c1a0b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _posts_columns(bind) -> set[str]:
    """Existing column names on the ``posts`` table (defensive adoption)."""
    return {c["name"] for c in sa.inspect(bind).get_columns("posts")}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    if not sa.inspect(bind).has_table("series"):
        op.create_table(
            "series",
            sa.Column("id", sa.Integer(), primary_key=True, index=True),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column(
                "slug",
                sa.String(length=200),
                nullable=False,
                unique=True,
                index=True,
            ),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )

    columns = _posts_columns(bind)
    if "series_id" not in columns:
        # No DB-level FOREIGN KEY here: SQLite's alembic dialect cannot add a
        # column carrying a FK to an existing table (batch-mode only, raises
        # NotImplementedError). Referential integrity is enforced at the ORM
        # layer — crud validates the series exists on create/update and
        # unlinks posts on series delete — and fresh dev DBs get the real FK
        # from create_all. Postgres still enforces it where a constraint can
        # be created in the initial schema.
        op.add_column(
            "posts",
            sa.Column("series_id", sa.Integer(), nullable=True),
        )
    if "series_order" not in columns:
        op.add_column(
            "posts",
            sa.Column(
                "series_order",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )
    # A column-level index on the new series_id keeps post-by-series lookups cheap.
    if "series_id" not in columns:
        op.create_index(op.f("ix_posts_series_id"), "posts", ["series_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    columns = _posts_columns(bind)
    if "series_id" in columns:
        op.drop_index(op.f("ix_posts_series_id"), table_name="posts", if_exists=True)
        op.drop_column("posts", "series_id")
    if "series_order" in columns:
        op.drop_column("posts", "series_order")
    if sa.inspect(bind).has_table("series"):
        op.drop_table("series")
