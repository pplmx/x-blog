"""add comments.edited_at for reader self-edits (DEC-096)

Reader-authors can edit their own comment (DEC-096 / TASK-160). A nullable
``edited_at`` records the last self-edit (null => never edited) so the UI can
show an "edited" marker. Entirely additive, matching DEC-009's additive-column
convention (plain nullable column, no FK).

Revision ID: e8d4c2a6f0b1
Revises: b7d1f3a5c9e2
Create Date: 2026-08-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8d4c2a6f0b1"
down_revision: str | Sequence[str] | None = "b7d1f3a5c9e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("comments"):
        # Fresh DB: create_all builds the full model.
        return
    existing = {col["name"] for col in sa.inspect(bind).get_columns("comments")}
    if "edited_at" not in existing:
        op.add_column("comments", sa.Column("edited_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("comments", "edited_at")
