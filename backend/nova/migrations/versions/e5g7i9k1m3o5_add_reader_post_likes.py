"""add reader_post_likes table (reader cloud-synced likes, round 359)

A brand-new additive table — no existing table is touched, so the
SQLite-can't-add-FK constraint of DEC-009 does not apply. Holds a signed-in
reader's likes of posts (reader_id, post_id) with a DB-level unique on the
pair so a reader can never like the same post twice — the server-enforced
"one like per post per reader" that guest localStorage dedup (RIL ISS-038)
could only approximate on the client. Mirrors ReaderBookmark (DEC-059/
TASK-132): the reader's reading artifacts (bookmarks, history, now likes)
persist across devices. No DB-level FK, additive.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5g7i9k1m3o5"
down_revision: str | Sequence[str] | None = "d4f6a8c0e2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reader_post_likes"):
        op.create_table(
            "reader_post_likes",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("reader_id", sa.Integer(), nullable=False, index=True),
            sa.Column("post_id", sa.Integer(), nullable=False, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("reader_id", "post_id", name="uq_reader_post_likes_reader_post"),
        )


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("reader_post_likes"):
        op.drop_table("reader_post_likes")
