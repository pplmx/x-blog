"""add comments.likes for comment upvotes (DEC-092)

Comment upvoting (DEC-092 / TASK-158) mirrors the post-likes precedent
(``posts.likes`` + ``POST /posts/{id}/like``): an additive per-comment counter
incremented by an anonymous, rate-limited endpoint. The count rides
``CommentPublic`` so every published comment exposes it.

Entirely additive (new column with a server default, no existing DDL touched,
DEC-009 preserved). Defensive like earlier column-adds: if the column already
exists (a dev DB whose create_all-era safety net already added it), it is left
as-is and only the version is stamped.

Revision ID: b7d1f3a5c9e2
Revises: f1e3d5b7a9c1
Create Date: 2026-08-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7d1f3a5c9e2"
down_revision: str | Sequence[str] | None = "f1e3d5b7a9c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    existing = {col["name"] for col in sa.inspect(bind).get_columns("comments")}
    if "likes" not in existing:
        op.add_column(
            "comments",
            sa.Column("likes", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("comments", "likes")
