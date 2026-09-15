"""add pages table (round 347)

A brand-new additive table only — no existing table is touched, so the
SQLite-can't-add-FK constraint of DEC-009 does not apply. Holds admin-curated
static pages (privacy policy, terms, contact, ...) published at /pages/{slug}:
markdown content (rendered client-side through the same pipeline as posts), a
``published`` flag gating the public route (an unpublished or unknown slug
answers the same 404, no-oracle), and a unique ``slug`` following the shared
lowercase-hyphen pattern so page URLs stay canonical. A defensive migration
guard keeps re-running idempotent like its siblings.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "x7f9a1c3e5d7"
down_revision: str | Sequence[str] | None = "p6g8b2d4f6a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("pages"):
        op.create_table(
            "pages",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("slug", sa.String(length=200), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "published",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_pages_slug", "pages", ["slug"], unique=True)
        op.create_index("ix_pages_id", "pages", ["id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("pages"):
        op.drop_table("pages")
