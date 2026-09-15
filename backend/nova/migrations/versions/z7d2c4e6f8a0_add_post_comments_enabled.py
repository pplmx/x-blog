"""add posts.comments_enabled (round 351)

A simple additive BOOLEAN column on the posts table — one new flag, no touch
to existing columns, so the SQLite-can't-add-FK constraint of DEC-009 does not
apply. ``server_default true()`` backfills every existing post as
comments-open, matching the ORM default, so no data rewrite is needed.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "z7d2c4e6f8a0"
down_revision: str | Sequence[str] | None = "y9f1b3d5e7f9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("posts") and "comments_enabled" not in _cols("posts"):
        # server_default backfills existing rows as comments-open.
        op.add_column(
            "posts",
            sa.Column(
                "comments_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
        )


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("posts") and "comments_enabled" in _cols("posts"):
        op.drop_column("posts", "comments_enabled")
