"""add reading_history.reading_minutes (denormalized read-time estimate)

/me/history/stats (ISS-451) used to fetch the reader's ENTIRE history and
materialize every post row—including `content`—just to SUM reading_minutes()
per row in Python: an O(all-time) scan that transfers multi-MB per /history
pageview for heavy readers.

This additive INTEGER column caches the per-post reading-time estimate on the
history row (one row per reader↔post pair), so the stats endpoint can aggregate
in SQL with zero content materialization. The data backfill below computes the
column for pre-existing rows from their post's CURRENT content, so displayed
totals do not jump on deploy; new writes carry the estimate for the content as
read. Follows DEC-009: only additive DDL, no existing column touched.

Revision ID: 7f2c4a6b8d1f
Revises: 6f9557747661
Create Date: 2026-09-18 00:00:00.000000

"""

import re
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7f2c4a6b8d1f"
down_revision: str | Sequence[str] | None = "6f9557747661"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Frozen copy of app.schemas.reading_minutes — migrations must not import app
# code (a migration is a snapshot; a later edit to the helper must not rewrite
# history). Keep in sync with schemas.py when the estimate formula changes.
# (The CJK classes below are the literal form of the escape ranges
# [⺀-⻿㐀-䶿一-鿿豈-﫿].)
_CJK_RE = re.compile(r"[⺀-⻿㐀-䶿一-鿿豈-﫿]")
_MD_STRIP_RE = re.compile(r"[#*`\n]")


def _reading_minutes(content: str | None) -> int:
    if not content:
        return 1
    text = _MD_STRIP_RE.sub(" ", content)
    tokens = text.split()
    cjk_chars = sum(len(_CJK_RE.findall(t)) for t in tokens)
    non_cjk_words = sum(1 for t in tokens if not _CJK_RE.search(t))
    words = non_cjk_words + cjk_chars
    return max(1, round(words / 200))


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("reading_history"):
        return
    columns = {c["name"] for c in sa.inspect(bind).get_columns("reading_history")}
    if "reading_minutes" not in columns:
        op.add_column(
            "reading_history",
            sa.Column("reading_minutes", sa.Integer(), nullable=False, server_default="1"),
        )

    # Backfill: existing rows get their estimate from the post's current
    # content, matching the totals the old Python path would have produced.
    # Row-by-row is fine for a personal-blog history table and keeps the
    # migration dialect-portable (SQLite + PostgreSQL).
    rows = bind.execute(
        sa.text("SELECT rh.id, p.content FROM reading_history rh LEFT JOIN posts p ON p.id = rh.post_id")
    ).fetchall()
    for row_id, content in rows:
        bind.execute(
            sa.text("UPDATE reading_history SET reading_minutes = :m WHERE id = :rid"),
            {"m": _reading_minutes(content), "rid": row_id},
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("reading_history", "reading_minutes")
