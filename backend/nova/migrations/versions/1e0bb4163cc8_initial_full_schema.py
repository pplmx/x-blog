"""initial_full_schema

Complete baseline migration: creates the full schema (categories, tags,
users, posts, comments, post_tags) matching the SQLAlchemy models, including
``publish_at`` and every ``index=True`` column.

Idempotent-by-design (RIL TASK-009): tables are created only when absent and
indexes only when not already present. This lets ``alembic upgrade head``
adopt databases that pre-date Alembic (schema built by
``Base.metadata.create_all``, no ``alembic_version`` row) without a manual
``alembic stamp head`` step, while still building a fresh database from
scratch.

Revision ID: 1e0bb4163cc8
Revises: (none — squashed from the removed bf9ccacf5b13 add-publish_at)
Create Date: 2026-08-10 00:02:44.771806

"""

from collections.abc import Sequence
from contextlib import suppress

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "1e0bb4163cc8"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _create_table_if_missing(name: str, *columns: sa.Column) -> None:
    """Create ``name`` unless it already exists (create_all-era adoption)."""
    bind = op.get_bind()
    if not bind.dialect.has_table(bind, name):
        op.create_table(name, *columns)


def _create_index_if_missing(
    name: str,
    table_name: str,
    columns: Sequence[str],
    *,
    unique: bool = False,
) -> None:
    """Create an index unless it already exists.

    ``create_index`` has no ``checkfirst``; on an adopted DB the create_all-era
    indexes are already present, so a duplicate-create raises OperationalError.
    That narrow case is the only thing caught — the table it indexes is
    guaranteed to exist by the caller.
    """
    with suppress(sa.exc.OperationalError):
        # Already present on a pre-alembic (create_all-era) database.
        op.create_index(name, table_name, list(columns), unique=unique)


def upgrade() -> None:
    """Upgrade schema."""
    _create_table_if_missing(
        "categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    _create_index_if_missing(op.f("ix_categories_id"), "categories", ["id"])

    _create_table_if_missing(
        "tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    _create_index_if_missing(op.f("ix_tags_id"), "tags", ["id"])

    _create_table_if_missing(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=50), nullable=False),
        sa.Column("password", sa.String(length=200), nullable=False),
        sa.Column("is_superuser", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_if_missing(op.f("ix_users_id"), "users", ["id"])
    _create_index_if_missing(op.f("ix_users_username"), "users", ["username"], unique=True)

    _create_table_if_missing(
        "posts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("slug", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("excerpt", sa.String(length=500), nullable=True),
        sa.Column("published", sa.Boolean(), nullable=True),
        sa.Column("pinned", sa.Boolean(), nullable=True),
        sa.Column("publish_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("cover_image", sa.String(length=500), nullable=True),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("likes", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_if_missing(op.f("ix_posts_category_id"), "posts", ["category_id"])
    _create_index_if_missing(op.f("ix_posts_created_at"), "posts", ["created_at"])
    _create_index_if_missing(op.f("ix_posts_id"), "posts", ["id"])
    _create_index_if_missing(op.f("ix_posts_publish_at"), "posts", ["publish_at"])
    _create_index_if_missing(op.f("ix_posts_published"), "posts", ["published"])
    _create_index_if_missing(op.f("ix_posts_slug"), "posts", ["slug"], unique=True)
    _create_index_if_missing(op.f("ix_posts_views"), "posts", ["views"])

    _create_table_if_missing(
        "comments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("parent_id", sa.Integer(), nullable=True),
        sa.Column("nickname", sa.String(length=50), nullable=False),
        sa.Column("email", sa.String(length=100), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("ip_address", sa.String(length=50), nullable=True),
        sa.Column("is_approved", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["parent_id"], ["comments.id"]),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    _create_index_if_missing(op.f("ix_comments_id"), "comments", ["id"])
    _create_index_if_missing(op.f("ix_comments_is_approved"), "comments", ["is_approved"])
    _create_index_if_missing(op.f("ix_comments_post_id"), "comments", ["post_id"])

    _create_table_if_missing(
        "post_tags",
        sa.Column("post_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["post_id"], ["posts.id"]),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"]),
        sa.PrimaryKeyConstraint("post_id", "tag_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("post_tags")
    op.drop_index(op.f("ix_comments_post_id"), table_name="comments")
    op.drop_index(op.f("ix_comments_is_approved"), table_name="comments")
    op.drop_index(op.f("ix_comments_id"), table_name="comments")
    op.drop_table("comments")
    op.drop_index(op.f("ix_posts_views"), table_name="posts")
    op.drop_index(op.f("ix_posts_slug"), table_name="posts")
    op.drop_index(op.f("ix_posts_published"), table_name="posts")
    op.drop_index(op.f("ix_posts_publish_at"), table_name="posts")
    op.drop_index(op.f("ix_posts_id"), table_name="posts")
    op.drop_index(op.f("ix_posts_created_at"), table_name="posts")
    op.drop_index(op.f("ix_posts_category_id"), table_name="posts")
    op.drop_table("posts")
    op.drop_index(op.f("ix_users_username"), table_name="users")
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_table("users")
    op.drop_index(op.f("ix_tags_id"), table_name="tags")
    op.drop_table("tags")
    op.drop_index(op.f("ix_categories_id"), table_name="categories")
    op.drop_table("categories")
