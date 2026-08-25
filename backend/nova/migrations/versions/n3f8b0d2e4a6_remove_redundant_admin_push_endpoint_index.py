"""remove redundant indexes

Revision ID: n3f8b0d2e4a6
Revises: m2e7a9c1d3f5
Create Date: 2026-08-25 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "n3f8b0d2e4a6"
down_revision: str | Sequence[str] | None = "m2e7a9c1d3f5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

REDUNDANT_INDEXES = (
    ("comment_subscriptions", "ix_comment_subscriptions_id"),
    ("admin_push_subscriptions", "ix_admin_push_subscriptions_id"),
    ("admin_push_subscriptions", "ix_admin_push_subscriptions_endpoint"),
    ("post_views_daily", "ix_post_views_daily_id"),
)
ENDPOINT_TABLE = "admin_push_subscriptions"
ENDPOINT_INDEX = "ix_admin_push_subscriptions_endpoint"


def upgrade() -> None:
    """Drop redundant non-unique indexes left by historical schema paths."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    to_drop = []
    for table_name, index_name in REDUNDANT_INDEXES:
        if not inspector.has_table(table_name):
            continue
        index = next(
            (item for item in inspector.get_indexes(table_name) if item["name"] == index_name),
            None,
        )
        if index is not None and not index.get("unique", False):
            to_drop.append((table_name, index_name))
    if not to_drop:
        return
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for table_name, index_name in to_drop:
                op.drop_index(
                    index_name,
                    table_name=table_name,
                    postgresql_concurrently=True,
                )
    else:
        for table_name, index_name in to_drop:
            op.drop_index(index_name, table_name=table_name)


def downgrade() -> None:
    """Restore the historical non-unique endpoint index."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table(ENDPOINT_TABLE):
        return
    indexes = {item["name"] for item in inspector.get_indexes(ENDPOINT_TABLE)}
    if ENDPOINT_INDEX in indexes:
        return
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.create_index(
                ENDPOINT_INDEX,
                ENDPOINT_TABLE,
                ["endpoint"],
                unique=False,
                postgresql_concurrently=True,
            )
    else:
        op.create_index(ENDPOINT_INDEX, ENDPOINT_TABLE, ["endpoint"], unique=False)
