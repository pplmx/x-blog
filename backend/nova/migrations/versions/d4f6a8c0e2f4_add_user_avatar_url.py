"""add users.avatar_url — the writer's public profile picture (round 358)

``users.bio`` (round 357) gave a pen-named writer a voice; ``avatar_url``
gives them a face. A superuser uploads a small profile picture next to the
pen name/bio in admin/users and it renders on every public rendering of the
writer: the post byline, the /authors index card, and the /authors/{id}
archive header — mirroring the reader avatar (ReaderAccount.avatar_url,
DEC-299/task 378). URL string (varchar 255) rather than a file path so the
public surface only ever carries a /static URL. NULL = no avatar yet.
Additive nullable column, no data change, no FK (DEC-009).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6a8c0e2f4"
down_revision: str | Sequence[str] | None = "c3e5f7a9b1d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    # `and` short-circuits: the column probe only runs when the table exists.
    if sa.inspect(op.get_bind()).has_table("users") and "avatar_url" not in _cols("users"):
        op.add_column("users", sa.Column("avatar_url", sa.String(255), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("users") and "avatar_url" in _cols("users"):
        op.drop_column("users", "avatar_url")
