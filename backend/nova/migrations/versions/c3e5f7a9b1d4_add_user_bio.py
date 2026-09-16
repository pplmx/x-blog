"""add users.bio — the writer's public 'about this writer' (round 357)

``users.display_name`` (round 343) gave an admin a public pen name; ``bio``
gives that public identity a voice. A short plain-text self-description set by
a superuser next to the pen name in admin/users, rendered under the writer's
name on their public /authors/{id} archive header — mirroring the reader bio
on ReaderAccount (round 352). NULL = no bio yet. Text (not VARCHAR) with the
500-char cap enforced at the schema boundary, exactly like the reader bio.
Additive nullable column, no data change, no FK (DEC-009).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3e5f7a9b1d4"
down_revision: str | Sequence[str] | None = "b2c4d6e8f0a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    """Upgrade schema."""
    # `and` short-circuits: the column probe only runs when the table exists.
    if sa.inspect(op.get_bind()).has_table("users") and "bio" not in _cols("users"):
        op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    if sa.inspect(op.get_bind()).has_table("users") and "bio" in _cols("users"):
        op.drop_column("users", "bio")
