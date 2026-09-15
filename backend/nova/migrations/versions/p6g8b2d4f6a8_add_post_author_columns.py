"""add post author attribution columns (DEC-359, TASK-405).

``users.display_name`` is the admin's public pen name — the byline shown on
published posts. Deliberately separate from the login ``username`` (admin login
is no-oracle; publishing usernames would hand out the first half of a
credential), NULL means "no public identity" and the author stays off the
public surface. ``posts.author_id`` is a plain additive INTEGER + index with no
DB-level FK — the DEC-009 convention for new references into existing tables
(SQLite alembic can't add FK-carrying columns in place; referential integrity
is enforced at the ORM layer). Both columns nullable, no data change.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p6g8b2d4f6a8"
down_revision: str | Sequence[str] | None = "o5f7a9c1e3d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    # `and` short-circuits: the column probe only runs when the table exists.
    if sa.inspect(op.get_bind()).has_table("users") and "display_name" not in _cols("users"):
        op.add_column("users", sa.Column("display_name", sa.String(50), nullable=True))
    if sa.inspect(op.get_bind()).has_table("posts"):
        if "author_id" not in _cols("posts"):
            op.add_column("posts", sa.Column("author_id", sa.Integer(), nullable=True))
        ix = "ix_posts_author_id"
        indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("posts")}
        if ix not in indexes:
            op.create_index(ix, "posts", ["author_id"])


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("posts"):
        ix = "ix_posts_author_id"
        indexes = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes("posts")}
        if ix in indexes:
            op.drop_index(ix, table_name="posts")
        if "author_id" in _cols("posts"):
            op.drop_column("posts", "author_id")
    if sa.inspect(op.get_bind()).has_table("users") and "display_name" in _cols("users"):
        op.drop_column("users", "display_name")
