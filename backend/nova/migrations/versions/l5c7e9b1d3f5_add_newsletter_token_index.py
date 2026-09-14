"""add unique index on newsletter_subscribers.token (DEC-351, TASK-401).

The confirm/unsubscribe endpoints look subscribers up by their opaque token;
a full-table scan per link click is avoidable with a unique index (tokens must
be unique — two subscribers can never share one unsubscribe secret). Pure
additive index on an existing column; no data change (DEC-009 style, though
this adds no column).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "l5c7e9b1d3f5"
down_revision: str | Sequence[str] | None = "k4f6a8c0e2d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("newsletter_subscribers"):
        ix = "ix_newsletter_subscribers_token"
        indexes = {i["name"] for i in sa.inspect(bind).get_indexes("newsletter_subscribers")}
        if ix not in indexes:
            op.create_index(ix, "newsletter_subscribers", ["token"], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()
    if sa.inspect(bind).has_table("newsletter_subscribers"):
        ix = "ix_newsletter_subscribers_token"
        indexes = {i["name"] for i in sa.inspect(bind).get_indexes("newsletter_subscribers")}
        if ix in indexes:
            op.drop_index(ix, table_name="newsletter_subscribers")
