"""add slug_redirects table (round 350)

A brand-new additive table only — no existing table is touched, so the
SQLite-can't-add-FK constraint of DEC-009 does not apply. Holds the 301
redirect map that preserves inbound links when an operator re-slugs a post,
series or static page: one row per (kind, old_slug), unique at the DB level so
a re-rename can never stack a duplicate redirect for the same old URL.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "y9f1b3d5e7f9"
down_revision: str | Sequence[str] | None = "x7f9a1c3e5d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("slug_redirects"):
        op.create_table(
            "slug_redirects",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("kind", sa.String(length=20), nullable=False),
            sa.Column("old_slug", sa.String(length=200), nullable=False),
            sa.Column("new_slug", sa.String(length=200), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("kind", "old_slug", name="uq_slug_redirects_kind_old_slug"),
        )
        op.create_index("ix_slug_redirects_id", "slug_redirects", ["id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("slug_redirects"):
        op.drop_table("slug_redirects")
