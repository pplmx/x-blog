"""Reader public profile and account deletion."""

from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import auth, models


async def get_reader_public_profile(db: AsyncSession, reader_id: int) -> models.ReaderAccount | None:
    """A reader's public identity for the profile page (DEC-294/TASK-376).

    Only the fields a public page may show — no email (PII), no last_login.
    Returns None for an unknown reader so the caller can 404.
    """
    return await db.get(auth.ReaderAccount, reader_id)


async def delete_reader_account(db: AsyncSession, reader_id: int) -> bool:
    """Permanently delete a reader account and detach their contributed data.

    Self-service account deletion (DEC-106, TASK-165): the comment *discussion*
    is preserved but anonymized (reader_id detached, keeping the stored
    nickname/content public but no longer account-linked — no verified badge),
    while the reader's cloud-synced bookmarks, comment-thread subscriptions and
    push subscriptions are removed. Returns False if the account does not exist.
    """
    reader = await db.get(auth.ReaderAccount, reader_id)
    if reader is None:
        return False

    # Anonymize the reader's comments instead of deleting them, so a public
    # thread isn't destroyed by an account leaving (identity detached; the row
    # keeps its nickname/content, so it renders without the verified badge).
    await db.execute(
        update(models.Comment).where(models.Comment.reader_id == reader_id).values({models.Comment.reader_id: None})
    )
    # Cloud-synced bookmarks and per-account subscriptions are account-private:
    # remove them outright.
    await db.execute(delete(models.ReaderBookmark).where(models.ReaderBookmark.reader_id == reader_id))
    await db.execute(delete(models.CommentSubscription).where(models.CommentSubscription.reader_id == reader_id))
    await db.execute(delete(models.PushSubscription).where(models.PushSubscription.reader_id == reader_id))
    await db.execute(delete(models.ReaderNotification).where(models.ReaderNotification.reader_id == reader_id))
    # Account-private rows the old deletion missed (backend deep-dive): category/
    # tag/series follows, bookmark folders, reading history, notification prefs,
    # post likes, author follows, and both directions of reader-to-reader
    # follow/block. Left behind, they kept pointing at the deleted reader_id —
    # and on SQLite (no AUTOINCREMENT) a future account could inherit the
    # recycled id with another reader's history/follows/likes (data leak between
    # accounts). ReaderFollow/ReaderBlock are cleaned in BOTH directions: the
    # deleted reader's own rows go, and other readers' rows that referenced them
    # (followed_id/blocked_id) go too, so a recycled id can't silently graft
    # someone else's relationship onto a new account.
    for model in (
        models.CategoryFollow,
        models.TagFollow,
        models.SeriesFollow,
        models.BookmarkFolder,
        models.ReadingHistory,
        models.ReaderNotificationPref,
        models.ReaderPostLike,
        models.AuthorFollow,
    ):
        await db.execute(delete(model).where(model.reader_id == reader_id))
    for model, col in (
        (models.ReaderFollow, models.ReaderFollow.reader_id),
        (models.ReaderFollow, models.ReaderFollow.followed_id),
        (models.ReaderBlock, models.ReaderBlock.blocker_id),
        (models.ReaderBlock, models.ReaderBlock.blocked_id),
    ):
        await db.execute(delete(model).where(col == reader_id))
    await db.delete(reader)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Cannot delete account: it has dependent records")
    return True
