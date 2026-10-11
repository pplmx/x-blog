"""Reader passage highlights (round 466, DEC-511 / TASK-583).

A signed-in reader saves an exact passage from a post, optionally with a short
private note. Responses include the post's current title/slug for deep-linking;
the list query joins Post in one pass (no per-row lazy load). Writes go through
``_commit_reader_upsert`` so they persist across request-scoped sessions.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app import models

from ._base import _commit_reader_upsert


async def get_reader_highlight(db: AsyncSession, reader_id: int, highlight_id: int) -> models.ReaderHighlight | None:
    """Return a highlight row owned by ``reader_id`` (or None)."""
    return (
        (
            await db.execute(
                select(models.ReaderHighlight).where(
                    models.ReaderHighlight.id == highlight_id,
                    models.ReaderHighlight.reader_id == reader_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def add_reader_highlight(
    db: AsyncSession,
    reader_id: int,
    post_id: int,
    text: str,
    note: str | None = None,
) -> tuple[models.ReaderHighlight, bool]:
    """Save (or re-return) a reader's highlight for ``(post_id, text)``.

    Idempotent: the reader/post/text triple is unique, so highlighting the same
    passage twice returns the existing row with ``created=False`` instead of
    duplicating (mirrors the bookmark/put idempotency contract). The commit is
    durable across the per-request session (production has a fresh session per
    request, so a bare flush would be rolled back before the next read).
    """
    existing = (
        await db.execute(
            select(models.ReaderHighlight).where(
                models.ReaderHighlight.reader_id == reader_id,
                models.ReaderHighlight.post_id == post_id,
                models.ReaderHighlight.text == text,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False
    row = models.ReaderHighlight(reader_id=reader_id, post_id=post_id, text=text, note=note)
    db.add(row)
    if await _commit_reader_upsert(db):
        await db.refresh(row)
        return row, True
    # Lost the unique-key race to a concurrent identical insert — re-fetch it.
    winner = (
        await db.execute(
            select(models.ReaderHighlight).where(
                models.ReaderHighlight.reader_id == reader_id,
                models.ReaderHighlight.post_id == post_id,
                models.ReaderHighlight.text == text,
            )
        )
    ).scalar_one_or_none()
    if winner is not None:
        return winner, False
    raise RuntimeError("highlight insert lost the unique-key race but no row was found")


async def list_reader_highlights(
    db: AsyncSession, reader_id: int, page: int = 1, limit: int = 50
) -> tuple[list[tuple[models.ReaderHighlight, models.Post | None]], int]:
    """The reader's highlights (newest first), joined with their posts.

    Returns ``(rows, total)`` where each ``rows`` element is ``(highlight,
    post)``. Post visibility is intentionally NOT filtered: these are the
    reader's own private passages, so a post that later became a draft still
    shows its title for the owner (they saw it when it was public). The join is
    a LEFT OUTER so a dangling post_id still yields the highlight row.
    """
    base = select(models.ReaderHighlight).where(models.ReaderHighlight.reader_id == reader_id)
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    query = (
        select(models.ReaderHighlight, models.Post)
        .join(models.Post, models.Post.id == models.ReaderHighlight.post_id, isouter=True)
        .where(models.ReaderHighlight.reader_id == reader_id)
        .options(joinedload(models.ReaderHighlight.post))
        .order_by(models.ReaderHighlight.created_at.desc(), models.ReaderHighlight.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    rows = (await db.execute(query)).all()
    return [(r[0], r[1]) for r in rows], total


async def update_reader_highlight_note(
    db: AsyncSession, reader_id: int, highlight_id: int, note: str | None
) -> models.ReaderHighlight | None:
    """Update a highlight's note (owner-only). Returns the row or None."""
    row = await get_reader_highlight(db, reader_id, highlight_id)
    if row is None:
        return None
    row.note = note
    if await _commit_reader_upsert(db):
        await db.refresh(row)
        return row
    return None


async def delete_reader_highlight(db: AsyncSession, reader_id: int, highlight_id: int) -> bool:
    """Delete a highlight (owner-only). Returns True if a row was removed."""
    row = await get_reader_highlight(db, reader_id, highlight_id)
    if row is None:
        return False
    await db.delete(row)
    await _commit_reader_upsert(db)
    return True
