from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, extract, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app import auth, models, schemas
from app.cache import (
    categories_cache,
    clear_categories_cache,
    clear_posts_list_cache,
    clear_series_cache,
    clear_tags_cache,
    tags_cache,
)
from app.emailer import EmailItem, dispatch_notification_emails, email_channel_enabled
from app.middleware import get_logger
from app.webpush import dispatch_new_post

logger = get_logger(__name__)


def utc_now_naive() -> datetime:
    """Current UTC time as a naive datetime.

    `publish_at`/`created_at` are stored as naive UTC in the DateTime columns
    (clients send naive ISO strings; the ORM default uses datetime.now(UTC)).
    Comparing against naive-UTC keeps all publish_at guards consistent across
    hosts, regardless of server local timezone.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def is_publicly_visible(post: models.Post) -> bool:
    """A post is public only when published and its publish_at (if any) has passed.

    publish_at is stored as naive UTC (see utc_now_naive); compare against
    naive-UTC now so a non-UTC server host cannot hide or leak scheduled posts.
    Shared by the public post read paths and the public comment-create guard.
    """
    if not post.published:
        return False
    if post.publish_at is None:
        return True
    publish_at = post.publish_at
    if publish_at.tzinfo is not None:
        publish_at = publish_at.astimezone(UTC).replace(tzinfo=None)
    return publish_at <= utc_now_naive()


def _populate_post_metrics(db: Session, posts: list[models.Post]) -> None:
    """Fill `comment_count` + `reading_time` on a list of Post in-place.

    comment_count is the approved-comment count per post, computed in ONE
    grouped query (no N+1) so cost scales with the page size. Shared by every
    public PostList-producing path (list / popular / related / adjacent) so a
    PostList consumer never gets a misleading 0 for a post that has comments
    (RIL TASK-109, ISS-089).
    """
    if not posts:
        return
    post_ids = [p.id for p in posts]
    rows = (
        db.query(models.Comment.post_id, func.count(models.Comment.id))
        .filter(
            models.Comment.post_id.in_(post_ids),
            models.Comment.is_approved == True,  # noqa: E712
        )
        .group_by(models.Comment.post_id)
        .all()
    )
    comment_counts = {post_id: int(count) for post_id, count in rows}
    for p in posts:
        p.comment_count = comment_counts.get(p.id, 0)
        p.reading_time = schemas.reading_minutes(p.content or "")


def get_posts(
    db: Session,
    skip: int = 0,
    limit: int = 10,
    published: bool = True,
    category_id: int | None = None,
    tag_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
) -> tuple[list[models.Post], int]:
    query = db.query(models.Post)

    if published:
        now = utc_now_naive()
        query = query.filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )

    if category_id:
        query = query.filter(models.Post.category_id == category_id)

    if tag_id:
        query = query.join(models.Post.tags).filter(models.Tag.id == tag_id).distinct()

    if year:
        query = query.filter(extract("year", models.Post.created_at) == year)
    if month:
        query = query.filter(extract("month", models.Post.created_at) == month)

    # Count before pagination
    total = query.count()

    # Eager load relationships to avoid N+1 queries
    query = query.options(
        joinedload(models.Post.category),
        joinedload(models.Post.tags),
    )

    # Sort by pinned first, then by created_at
    posts = query.order_by(models.Post.pinned.desc(), models.Post.created_at.desc()).offset(skip).limit(limit).all()

    # Populate comment_count (approved) + reading_time in one pass (no N+1).
    _populate_post_metrics(db, posts)
    return posts, total


def get_archive(db: Session) -> list[tuple[int, int, int]]:
    """Group publicly-visible posts by (year, month) of their created_at.

    Returns rows ordered newest-first as (year, month, count). Only posts that
    are published and whose publish_at (if set) has passed are counted, so the
    archive index never reveals drafts or scheduled future posts.
    """
    now = utc_now_naive()
    rows = (
        db.query(
            extract("year", models.Post.created_at).label("year"),
            extract("month", models.Post.created_at).label("month"),
            func.count(models.Post.id).label("count"),
        )
        .filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .group_by("year", "month")
        .order_by(extract("year", models.Post.created_at).desc(), extract("month", models.Post.created_at).desc())
        .all()
    )
    # Positional Row access (year, month, count — the SELECT order): pyright
    # cannot resolve label attributes on an untyped SQLAlchemy Row, and
    # getattr() with a constant trips ruff B009.
    return [(int(r[0]), int(r[1]), int(r[2])) for r in rows]


def get_post(db: Session, post_id: int) -> models.Post | None:
    return (
        db.query(models.Post)
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
        )
        .filter(models.Post.id == post_id)
        .first()
    )


def get_post_by_slug(db: Session, slug: str) -> models.Post | None:
    return (
        db.query(models.Post)
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
        )
        .filter(models.Post.slug == slug)
        .first()
    )


def create_post(db: Session, post: schemas.PostCreate) -> models.Post:
    category = None
    if post.category_id:
        category = db.query(models.Category).filter(models.Category.id == post.category_id).first()
        if not category:
            raise ValueError(f"Category with id {post.category_id} not found")

    if post.series_id:
        series = db.query(models.Series).filter(models.Series.id == post.series_id).first()
        if not series:
            raise ValueError(f"Series with id {post.series_id} not found")

    tags = []
    for tag_name in post.tags:
        tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
        if not tag:
            tag = models.Tag(name=tag_name)
            db.add(tag)
            db.flush()
        tags.append(tag)

    db_post = models.Post(
        title=post.title,
        slug=post.slug,
        content=post.content,
        excerpt=post.excerpt,
        published=post.published,
        pinned=post.pinned,
        publish_at=post.publish_at,
        category_id=post.category_id,
        series_id=post.series_id,
        series_order=post.series_order,
        cover_image=post.cover_image,
    )
    db_post.tags = tags
    db.add(db_post)
    try:
        # Flush once so db_post.id is available, then capture the initial
        # revision in the SAME transaction as the post, and commit once. A
        # single commit keeps the unit test that mocks commit/refresh valid
        # (clears the tags cache exactly once, no double-flush slug clash).
        db.flush()
        _snapshot_revision(db, db_post)
        db.commit()
        db.refresh(db_post)
    except IntegrityError:
        db.rollback()
        raise ValueError(f"Slug '{post.slug}' already exists")
    except Exception:
        db.rollback()
        raise

    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()

    # A post created as immediately visible is a new post — fan out the
    # new-post push (DEC-076, TASK-147). Best effort, no-op when unconfigured.
    if is_publicly_visible(db_post):
        record_new_post_notifications(db, db_post)
        dispatch_new_post(db, db_post, logger)
    return db_post


def update_post(db: Session, post_id: int, post: schemas.PostUpdate) -> models.Post | None:
    db_post = get_post(db, post_id)
    if not db_post:
        return None

    # Notify on the transition into visibility (draft/scheduled -> published),
    # not on every edit of an already-published post (DEC-076/TASK-147).
    was_visible = is_publicly_visible(db_post)
    update_data = post.model_dump(exclude_unset=True)

    if "category_id" in update_data and update_data["category_id"] is not None:
        category = db.query(models.Category).filter(models.Category.id == update_data["category_id"]).first()
        if not category:
            raise ValueError(f"Category with id {update_data['category_id']} not found")

    if "series_id" in update_data and update_data["series_id"] is not None:
        series = db.query(models.Series).filter(models.Series.id == update_data["series_id"]).first()
        if not series:
            raise ValueError(f"Series with id {update_data['series_id']} not found")

    if "tag_ids" in update_data:
        tag_id_list = update_data.pop("tag_ids")
        tags = db.query(models.Tag).filter(models.Tag.id.in_(tag_id_list)).all() if tag_id_list else []
        db_post.tags = tags

    for field, value in update_data.items():
        setattr(db_post, field, value)

    try:
        # Capture the updated state as a new revision in the same transaction
        # as the field changes, then commit once (single-commit pattern).
        _snapshot_revision(db, db_post)
        db.commit()
        db.refresh(db_post)
    except IntegrityError:
        db.rollback()
        raise ValueError("Slug or unique constraint already exists")
    except Exception:
        db.rollback()
        raise

    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()

    # Only the draft/scheduled -> published transition notifies (see above).
    if not was_visible and is_publicly_visible(db_post):
        record_new_post_notifications(db, db_post)
        dispatch_new_post(db, db_post, logger)
    return db_post


# ---- Post revision history (DEC-158, TASK-191) ---------------------------

MAX_REVISIONS_PER_POST = 100


def capture_post_revision(db: Session, db_post: models.Post) -> None:
    """Snapshot the post's current state as a new revision and commit it.

    Public (not underscore-prefixed) because the admin PUT route applies edits
    in the router (it does not call ``crud.update_post``), so it must be able
    to invoke the same capture the crud paths use (DEC-158, TASK-191).
    """
    _snapshot_revision(db, db_post)
    db.commit()


def _snapshot_revision(db: Session, db_post: models.Post) -> None:
    """Persist an immutable snapshot of the post's editable fields.

    Called on every admin create/update (and before a restore, so a restore is
    itself undo-able). Retention-capped per post so long auto-save sessions
    don't grow history without bound.
    """
    rev = models.PostRevision(
        post_id=db_post.id,
        title=db_post.title,
        slug=db_post.slug,
        content=db_post.content,
        excerpt=db_post.excerpt,
        cover_image=db_post.cover_image,
        category_id=db_post.category_id,
        series_id=db_post.series_id,
        series_order=db_post.series_order,
        publish_at=db_post.publish_at,
        pinned=bool(db_post.pinned),
        published=bool(db_post.published),
    )
    db.add(rev)
    db.flush()
    _prune_revisions(db, db_post.id)


def _prune_revisions(db: Session, post_id: int) -> None:
    """Keep only the most recent MAX_REVISIONS_PER_POST revisions for a post."""
    total = db.query(models.PostRevision).filter(models.PostRevision.post_id == post_id).count()
    overflow = total - MAX_REVISIONS_PER_POST
    if overflow <= 0:
        return
    oldest = (
        db.query(models.PostRevision)
        .filter(models.PostRevision.post_id == post_id)
        .order_by(models.PostRevision.id.asc())
        .limit(overflow)
        .all()
    )
    for rev in oldest:
        db.delete(rev)


def get_post_revisions(
    db: Session,
    post_id: int,
    limit: int = 100,
) -> list[models.PostRevision]:
    """Newest-first revision history for a post, bounded by ``limit``."""
    return (
        db.query(models.PostRevision)
        .filter(models.PostRevision.post_id == post_id)
        .order_by(models.PostRevision.id.desc())
        .limit(limit)
        .all()
    )


def get_post_revision(
    db: Session,
    post_id: int,
    revision_id: int,
) -> models.PostRevision | None:
    return (
        db.query(models.PostRevision)
        .filter(
            models.PostRevision.id == revision_id,
            models.PostRevision.post_id == post_id,
        )
        .first()
    )


def restore_post_revision(
    db: Session,
    post_id: int,
    revision_id: int,
) -> models.Post:
    """Apply a stored revision to the live post, snapshotting the current state
    first so the restore itself is part of the history (undo-able)."""
    db_post = get_post(db, post_id)
    if not db_post:
        raise ValueError("Post not found")
    target = get_post_revision(db, post_id, revision_id)
    if not target:
        raise ValueError("Revision not found")

    _snapshot_revision(db, db_post)
    db_post.title = target.title
    db_post.slug = target.slug
    db_post.content = target.content
    db_post.excerpt = target.excerpt
    db_post.cover_image = target.cover_image
    db_post.category_id = target.category_id
    db_post.series_id = target.series_id
    db_post.series_order = target.series_order
    db_post.publish_at = target.publish_at
    db_post.pinned = bool(target.pinned)
    db_post.published = bool(target.published)
    try:
        db.commit()
        db.refresh(db_post)
    except IntegrityError:
        db.rollback()
        raise ValueError("Slug or unique constraint already exists")
    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()
    return db_post


def delete_post(db: Session, post_id: int) -> bool:
    db_post = db.get(models.Post, post_id)
    if not db_post:
        return False
    db.delete(db_post)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete post: it has dependent records")
    clear_tags_cache()
    clear_categories_cache()
    clear_posts_list_cache()
    return True


def get_categories(db: Session) -> list[dict]:
    # Check cache first
    cache_key = "all_categories"
    if cache_key in categories_cache:
        return categories_cache[cache_key]

    # Query database
    categories = db.query(models.Category).all()

    # Post count per category in a single grouped query (no N+1).
    rows = (
        db.query(models.Post.category_id, func.count(models.Post.id))
        .filter(models.Post.category_id.isnot(None))
        .group_by(models.Post.category_id)
        .all()
    )
    counts = {cat_id: int(count) for cat_id, count in rows}

    # Cache plain dicts, not live ORM objects, so values survive across
    # per-request Sessions (invariant documented in cache.py). post_count is
    # not a column; it is computed and baked into the dict here.
    result = [{"id": cat.id, "name": cat.name, "post_count": counts.get(cat.id, 0)} for cat in categories]

    # Cache the result
    categories_cache[cache_key] = result
    return result


def get_category(db: Session, category_id: int) -> models.Category | None:
    return db.query(models.Category).filter(models.Category.id == category_id).first()


def get_category_by_name(db: Session, name: str) -> models.Category | None:
    return db.query(models.Category).filter(models.Category.name == name).first()


def create_category(db: Session, category: schemas.CategoryCreate) -> models.Category:
    db_category = models.Category(name=category.name)
    db.add(db_category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError(f"Category with name '{category.name}' already exists")
    db.refresh(db_category)
    # Clear cache
    clear_categories_cache()
    return db_category


def update_category(db: Session, category_id: int, category: schemas.CategoryCreate) -> models.Category | None:
    db_category = get_category(db, category_id)
    if not db_category:
        return None
    db_category.name = category.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError(f"Category with name '{category.name}' already exists")
    db.refresh(db_category)
    # Clear cache
    clear_categories_cache()
    return db_category


def delete_category(db: Session, category_id: int) -> bool:
    db_category = get_category(db, category_id)
    if not db_category:
        return False
    # Check for posts referencing this category (proactive FK check)
    post_count = db.query(models.Post).filter(models.Post.category_id == category_id).count()
    if post_count > 0:
        raise ValueError("Cannot delete category: it is referenced by posts")
    db.delete(db_category)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete category: it is referenced by posts")
    # Clear cache
    clear_categories_cache()
    return True


def get_tags(db: Session) -> list[dict]:
    # Check cache first
    cache_key = "all_tags"
    if cache_key in tags_cache:
        return tags_cache[cache_key]

    # Query database
    tags = db.query(models.Tag).all()

    # Post count per tag through the many-to-many join, one grouped query.
    rows = (
        db.query(models.post_tags.c.tag_id, func.count(models.post_tags.c.post_id))
        .group_by(models.post_tags.c.tag_id)
        .all()
    )
    counts = {tag_id: int(count) for tag_id, count in rows}

    # Cache plain dicts, not live ORM objects, so values survive across
    # per-request Sessions (invariant documented in cache.py). post_count is
    # not a column; it is computed and baked into the dict here.
    result = [{"id": tag.id, "name": tag.name, "post_count": counts.get(tag.id, 0)} for tag in tags]

    # Cache the result
    tags_cache[cache_key] = result
    return result


def get_tag(db: Session, tag_id: int) -> models.Tag | None:
    return db.query(models.Tag).filter(models.Tag.id == tag_id).first()


def get_tag_by_name(db: Session, name: str) -> models.Tag | None:
    return db.query(models.Tag).filter(models.Tag.name == name).first()


def create_tag(db: Session, tag: schemas.TagCreate) -> models.Tag:
    db_tag = models.Tag(name=tag.name)
    db.add(db_tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError(f"Tag with name '{tag.name}' already exists")
    db.refresh(db_tag)
    # Clear cache
    clear_tags_cache()
    return db_tag


def update_tag(db: Session, tag_id: int, tag: schemas.TagCreate) -> models.Tag | None:
    db_tag = get_tag(db, tag_id)
    if db_tag:
        db_tag.name = tag.name
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise ValueError(f"Tag with name '{tag.name}' already exists")
        db.refresh(db_tag)
        # Clear cache
        clear_tags_cache()
    return db_tag


def delete_tag(db: Session, tag_id: int) -> bool:
    db_tag = get_tag(db, tag_id)
    if db_tag:
        # Check for posts referencing this tag (proactive FK check)
        post_count = db.query(models.Post).filter(models.Post.tags.any(id=tag_id)).count()
        if post_count > 0:
            raise ValueError("Cannot delete tag: it is referenced by posts")
        db.delete(db_tag)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise ValueError("Cannot delete tag: it is referenced by posts")
        # Clear cache
        clear_tags_cache()
        return True
    return False


def get_comments(db: Session, post_id: int) -> list[models.Comment]:
    return (
        db.query(models.Comment)
        .filter(models.Comment.post_id == post_id)
        .order_by(models.Comment.created_at.desc())
        .all()
    )


def get_comments_paginated(
    db: Session,
    post_id: int,
    page: int = 1,
    limit: int = 20,
    sort: str = "newest",
) -> tuple[list[models.Comment], int]:
    """Get paginated approved comments for a post.

    ``sort`` is one of ``newest`` (default, created_at desc), ``oldest``
    (created_at asc) or ``likes`` (likes desc, created_at desc tiebreak).
    The caller is responsible for whitelisting the value before this runs;
    anything else falls back to the default newest order (DEC-094, TASK-159).

    Returns:
        Tuple of (comments list, total count)
    """
    query = db.query(models.Comment).filter(
        models.Comment.post_id == post_id,
        models.Comment.is_approved == True,  # noqa: E712
    )

    total = query.count()
    if sort == "oldest":
        order = [models.Comment.created_at.asc()]
    elif sort == "likes":
        # Most helpful first; newest wins ties among equal like counts.
        order = [models.Comment.likes.desc(), models.Comment.created_at.desc()]
    else:
        order = [models.Comment.created_at.desc()]
    comments = query.order_by(*order).offset((page - 1) * limit).limit(limit).all()

    return comments, total


def create_comment(
    db: Session,
    post_id: int,
    comment: schemas.CommentCreate,
    ip_address: str,
    reader: auth.ReaderAccount | None = None,
) -> models.Comment:
    # Validate that the post exists
    post = db.get(models.Post, post_id)
    if not post:
        raise ValueError(f"Post with id {post_id} not found")

    # Validate parent comment (for threaded replies)
    if comment.parent_id is not None:
        parent = db.get(models.Comment, comment.parent_id)
        if not parent:
            raise ValueError(f"Parent comment with id {comment.parent_id} not found")
        if parent.post_id != post_id:
            raise ValueError("Parent comment does not belong to this post")
        # Only approved parents are publicly visible; blocking replies to
        # pending/rejected comments prevents an approved reply from being
        # orphaned under a parent a moderator later rejects.
        if not parent.is_approved:
            raise ValueError("Cannot reply to a comment awaiting approval")

    # Reader-attributed comments (DEC-062): when a signed-in reader authors the
    # comment, their identity is stamped from the account — client-supplied
    # nickname/email are IGNORED (a reader cannot spoof another's display name
    # or attach a bogus email). Using the account's email would stash PII in the
    # comment row; we store the reader_id only and keep the account email on
    # reader_accounts. Anonymous comments keep their free-text nickname/email.
    if reader is not None:
        comment_nickname = reader.display_name or reader.email
        comment_email: str | None = None
        reader_id: int | None = reader.id
    else:
        comment_nickname = comment.nickname
        comment_email = comment.email
        reader_id = None

    db_comment = models.Comment(
        post_id=post_id,
        parent_id=comment.parent_id,
        nickname=comment_nickname,
        email=comment_email,
        content=comment.content,
        ip_address=ip_address,
        reader_id=reader_id,
        # Moderation: comments are never auto-approved; an admin must approve
        # them via the approve/batch-approve endpoints. The client's value is
        # ignored (CommentCreate no longer accepts is_approved).
        is_approved=False,
    )
    db.add(db_comment)
    try:
        db.commit()
        db.refresh(db_comment)
    except IntegrityError:
        db.rollback()
        raise ValueError("Failed to create comment")
    # The public posts list serializes approved comment_count per post; a new
    # (or subsequently approved) comment changes those counts, so invalidate
    # the cached list rather than wait up to 300s TTL (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return db_comment


def approve_comment(db: Session, comment_id: int, approved: bool = True) -> models.Comment | None:
    """Approve or reject a comment."""
    comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
    if not comment:
        return None
    comment.is_approved = approved
    # Reviewed_at distinguishes "still pending" from "reviewed and rejected" for
    # the author's comment history (DEC-066, TASK-139). Set on both outcomes.
    comment.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(comment)
    # Approving (or rejecting) a comment changes the approved comment_count
    # surfaced on the cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return comment


def delete_reader_comment(db: Session, comment_id: int, reader_id: int) -> bool:
    """Delete one of the reader's own comments (any status). False if the
    comment is missing or belongs to a different reader. (DEC-066, TASK-139)

    Replies are reparented to this comment's parent (or promoted to top-level
    when it had none) rather than blocking the delete, so a reader can withdraw
    a comment that already has replies without orphaning the thread (DEC-096,
    TASK-160). Deeper descendants ride along under the promoted reply.
    """
    comment = (
        db.query(models.Comment).filter(models.Comment.id == comment_id, models.Comment.reader_id == reader_id).first()
    )
    if not comment:
        return False
    # Promote direct replies to the deleted comment's parent (or to top-level).
    # SQLAlchemy's bulk update avoids loading each reply; synchronize_session
    # is disabled because we only need the DB state.
    target_parent = comment.parent_id
    db.query(models.Comment).filter(models.Comment.parent_id == comment_id).update(
        {models.Comment.parent_id: target_parent},
        synchronize_session=False,
    )
    db.delete(comment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete comment: it has dependent records")
    # Same as admin delete: removing an approved comment changes the approved
    # comment_count on the cached public posts list.
    clear_posts_list_cache()
    return True


def update_reader_comment(db: Session, comment_id: int, reader_id: int, content: str) -> models.Comment | None:
    """Edit one of the reader's own comments (any status).

    Returns the updated comment, or None if it is missing or belongs to a
    different reader (indistinguishable 404). Content is stored raw and
    re-rendered through the same sanitized markdown pipeline as a new comment,
    so an edit can never weaken the XSS guarantees (DEC-096, TASK-160). The
    ``edited_at`` marker is stamped so the UI can surface it.
    """
    comment = (
        db.query(models.Comment).filter(models.Comment.id == comment_id, models.Comment.reader_id == reader_id).first()
    )
    if not comment:
        return None
    comment.content = content
    comment.edited_at = datetime.now(UTC)
    db.commit()
    db.refresh(comment)
    return comment


def get_pending_comments(db: Session) -> list[models.Comment]:
    """Get all pending (unapproved) comments."""
    return (
        db.query(models.Comment)
        .filter(models.Comment.is_approved == False)  # noqa: E712
        .order_by(models.Comment.created_at.desc())
        .all()
    )


def get_all_comments(db: Session) -> list[models.Comment]:
    """Get all comments for admin review."""
    return db.query(models.Comment).order_by(models.Comment.created_at.desc()).all()


def bulk_delete_comments(db: Session, ids: list[int]) -> int:
    """Delete many comments at once, keeping the thread consistent (DEC-110).

    Surviving direct replies of a deleted comment are promoted to the nearest
    surviving ancestor (or top-level) — walking up past any ancestors that are
    themselves being deleted — so a bulk delete never orphans a thread or
    leaves a reply pointing at a deleted parent. Returns the number deleted.
    """
    delete_set = set(ids)
    comments = db.query(models.Comment).filter(models.Comment.id.in_(delete_set)).all()
    if not comments:
        return 0
    existing_ids = {c.id for c in comments}
    for c in comments:
        survivor_ids = [
            sid
            for (sid,) in db.query(models.Comment.id)
            .filter(models.Comment.parent_id == c.id, models.Comment.id.notin_(existing_ids))
            .all()
        ]
        if not survivor_ids:
            continue
        # Nearest ancestor of c that is not itself being deleted.
        eff_parent = c.parent_id
        seen: set[int] = set()
        while eff_parent is not None and eff_parent in existing_ids and eff_parent not in seen:
            seen.add(eff_parent)
            up = db.get(models.Comment, eff_parent)
            eff_parent = up.parent_id if up is not None else None
        db.query(models.Comment).filter(models.Comment.id.in_(survivor_ids)).update(
            {models.Comment.parent_id: eff_parent},
            synchronize_session=False,
        )
    for c in comments:
        db.delete(c)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete comments: dependent records remain")
    # Deleting approved comments changes the approved comment_count on the
    # cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return len(comments)


def delete_comment(db: Session, comment_id: int) -> bool:
    comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
    if not comment:
        return False
    db.delete(comment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete comment: it has dependent records")
    # Deleting an approved comment changes the approved comment_count surfaced
    # on the cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
    return True


def escape_like_pattern(query: str) -> str:
    """Escape LIKE metacharacters so user input matches literally.

    % and _ would otherwise act as wildcards and degenerate into full-table
    matches (issue #20). Must be paired with ``escape="\\"`` on ilike/like.
    """
    return query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _has_cjk(query: str) -> bool:
    """True when the query contains CJK ideographs.

    Postgres ``to_tsvector('english')`` tokenizes CJK as opaque runs, so
    full-text search cannot match partial/prefix Chinese terms ('评' vs content
    '评论系统') — while SQLite's ILIKE substring path handles them fine. Detect
    CJK in Python (not by dialect) so the fallback to substring matching is
    identical on SQLite and Postgres. (DEC-070, TASK-143)
    """
    return any(
        ("㐀" <= ch <= "䶿")  # CJK Extension A
        or ("一" <= ch <= "鿿")  # CJK Unified Ideographs
        or ("豈" <= ch <= "﫿")  # CJK Compatibility Ideographs
        for ch in query
    )


def search_posts(
    db: Session,
    query: str,
    page: int = 1,
    limit: int = 10,
    category: str | None = None,
    tag: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    sort: str = "relevance",
) -> tuple[list[models.Post], int]:
    offset = (page - 1) * limit
    is_postgres = db.get_bind().dialect.name == "postgresql"
    # CJK/mixed queries go through the dialect-agnostic ILIKE substring path on
    # every backend; only pure-ASCII Postgres queries keep tsvector relevance.
    use_tsvector = is_postgres and not _has_cjk(query)

    now = utc_now_naive()
    # Scheduled posts are not searchable before their publish_at (same rule as list)
    scheduled_filter = or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now)

    # Narrowing filters (DEC-084, TASK-154): category/tag by NAME, plus a
    # created_at range. Applied identically on both dialect paths. The range
    # columns are naive UTC (see utc_now_naive); coerce whatever the client
    # sent (naive or aware, ISO or date) to naive UTC before comparing.
    filters = []
    if category:
        filters.append(models.Post.category_id.in_(select(models.Category.id).where(models.Category.name == category)))
    if tag:
        filters.append(models.Post.tags.any(models.Tag.name == tag))
    if date_from is not None:
        filters.append(models.Post.created_at >= date_from)
    if date_to is not None:
        filters.append(models.Post.created_at <= date_to)

    # Sort applied below per dialect branch (tsvector relevance is a real
    # metric; the CJK substring path has none, so "relevance" degrades to
    # newest there — documented in DEC-084).
    def _sort_order(ts_vector=None, ts_query=None):
        if sort == "newest":
            return models.Post.created_at.desc()
        if sort == "oldest":
            return models.Post.created_at.asc()
        if sort == "views":
            return models.Post.views.desc()
        if sort == "relevance" and ts_vector is not None:
            return func.ts_rank(ts_vector, ts_query).desc()
        return models.Post.created_at.desc()

    if use_tsvector:
        ts_query = func.plainto_tsquery("english", query)
        ts_vector = func.to_tsvector(
            "english",
            models.Post.title + " " + func.coalesce(models.Post.excerpt, "") + " " + models.Post.content,
        )

        stmt = (
            select(models.Post)
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
            .where(ts_vector.op("@@")(ts_query))
            .order_by(_sort_order(ts_vector, ts_query))
            .options(
                joinedload(models.Post.category),
                joinedload(models.Post.tags),
            )
            .offset(offset)
            .limit(limit)
        )

        count_stmt = (
            select(func.count(models.Post.id))
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
            .where(ts_vector.op("@@")(ts_query))
        )
    else:
        # CJK/mixed substring matching: every whitespace-separated term must
        # appear (as a substring) in the title, excerpt, or content. Per-term
        # OR over fields, AND over terms — mirrors plainto_tsquery AND semantics
        # so a query like "TypeScript 类型" matches TypeScript in the title and
        # 类型 in the content. excerpt is covered like the tsvector path.
        terms = [t for t in query.split() if t] or [query]
        fields = (
            models.Post.title,
            models.Post.excerpt,
            models.Post.content,
        )
        term_clauses = [
            and_(or_(*(field.ilike(f"%{escape_like_pattern(term)}%", escape="\\") for field in fields)))
            for term in terms
        ]

        stmt = (
            select(models.Post)
            .where(and_(*term_clauses))
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
            .order_by(_sort_order())
            .options(
                joinedload(models.Post.category),
                joinedload(models.Post.tags),
            )
            .offset(offset)
            .limit(limit)
        )

        count_stmt = (
            select(func.count(models.Post.id))
            .where(and_(*term_clauses))
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(*filters)
        )

    posts = list(db.execute(stmt).unique().scalars().all())
    total = db.execute(count_stmt).scalar()
    assert total is not None  # COUNT(*) always yields one row

    return posts, total


def increment_views(db: Session, post_id: int) -> models.Post | None:
    """Increment the view count for a post using atomic SQL update.

    Also upserts today's row in ``post_views_daily`` (DEC-086) so the admin
    dashboard's reading-trend series advances on the same write-on-read path.
    One extra small statement per pageview rides the existing UPDATE+commit;
    coalescing these writes is tracked separately (TASK-026).
    """
    stmt = update(models.Post).where(models.Post.id == post_id).values(views=models.Post.views + 1)
    db.execute(stmt)
    today = utc_now_naive().date()
    daily = db.query(models.PostViewsDaily).filter_by(post_id=post_id, day=today).first()
    if daily is not None:
        daily.views = (daily.views or 0) + 1
    else:
        db.add(models.PostViewsDaily(post_id=post_id, day=today, views=1))
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    post = db.get(models.Post, post_id)
    if post:
        db.refresh(post)
    return post


def increment_likes(db: Session, post_id: int) -> models.Post | None:
    """Increment the like count for a post using atomic SQL update."""
    stmt = update(models.Post).where(models.Post.id == post_id).values(likes=models.Post.likes + 1)
    db.execute(stmt)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    post = db.get(models.Post, post_id)
    if post:
        db.refresh(post)
    return post


def flag_comment(db: Session, comment_id: int, ip_key: str, reason: str | None = None) -> tuple[bool, int]:
    """Record a reader flag on a comment; idempotent per (comment, ip_key).

    Returns (created_new, total_distinct_flags). A second flag from the same
    source key is a no-op (unique constraint) so the moderator sees distinct
    reporters, not click spam (DEC-108, TASK-166).
    """
    existing = (
        db.query(models.CommentFlag)
        .filter(models.CommentFlag.comment_id == comment_id, models.CommentFlag.ip_key == ip_key)
        .first()
    )
    if existing is None:
        db.add(models.CommentFlag(comment_id=comment_id, ip_key=ip_key, reason=reason))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # concurrent duplicate → treat as idempotent no-op
    total = db.query(models.CommentFlag).filter(models.CommentFlag.comment_id == comment_id).count()
    return existing is None, total


def flag_counts_for_comments(db: Session, comment_ids: list[int]) -> dict[int, int]:
    """Map comment_id -> distinct-flag count for the admin comment list."""
    if not comment_ids:
        return {}
    rows = (
        db.query(models.CommentFlag.comment_id, func.count(models.CommentFlag.id))
        .filter(models.CommentFlag.comment_id.in_(comment_ids))
        .group_by(models.CommentFlag.comment_id)
        .all()
    )
    counts: dict[int, int] = {}
    for cid, count in rows:
        counts[int(cid)] = int(count)
    return counts


def dismiss_comment_flags(db: Session, comment_id: int) -> int:
    """Clear all flags on a comment (moderator dismissed the reports)."""
    removed = (
        db.query(models.CommentFlag)
        .filter(models.CommentFlag.comment_id == comment_id)
        .delete(synchronize_session=False)
    )
    db.commit()
    return removed


def increment_comment_likes(db: Session, comment_id: int) -> models.Comment | None:
    """Increment the like count for a comment using atomic SQL update."""
    stmt = update(models.Comment).where(models.Comment.id == comment_id).values(likes=models.Comment.likes + 1)
    db.execute(stmt)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    comment = db.get(models.Comment, comment_id)
    if comment:
        db.refresh(comment)
    return comment


def get_popular_posts(db: Session, limit: int = 5) -> list[models.Post]:
    """Get the most popular posts by view count."""
    now = utc_now_naive()
    posts = (
        db.query(models.Post)
        .filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
        )
        .order_by(models.Post.views.desc(), models.Post.id.desc())
        .limit(limit)
        .all()
    )
    _populate_post_metrics(db, posts)
    return posts


def get_related_posts(db: Session, post_id: int, limit: int = 5) -> list[models.Post]:
    """Get related posts based on category and tags.

    Uses SQL-based tag matching for better performance.
    """
    post = get_post(db, post_id)
    if not post or not post.tags:
        # Fallback: just get recent posts in same category
        now = utc_now_naive()
        query = db.query(models.Post).filter(
            models.Post.published.is_(True),
            models.Post.id != post_id,
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        if post and post.category_id:
            query = query.filter(models.Post.category_id == post.category_id)
        posts = (
            query.options(
                joinedload(models.Post.category),
                joinedload(models.Post.tags),
            )
            .order_by(models.Post.created_at.desc())
            .limit(limit)
            .all()
        )
        _populate_post_metrics(db, posts)
        return posts

    # Get tag IDs of the source post
    source_tag_ids = [t.id for t in post.tags]

    # SQL-based matching: find posts sharing tags, prioritize same category
    # Use a subquery to count matching tags
    from sqlalchemy import case

    # Access the post_tags table from models
    post_tags_table = models.post_tags

    tag_match_count_subq = (
        db.query(post_tags_table.c.post_id, func.count(post_tags_table.c.tag_id).label("match_count"))
        .filter(post_tags_table.c.tag_id.in_(source_tag_ids))
        .group_by(post_tags_table.c.post_id)
        .subquery()
    )

    # Build main query with tag match count and eager loading
    now = utc_now_naive()
    query = (
        db.query(models.Post, tag_match_count_subq.c.match_count)
        .outerjoin(tag_match_count_subq, models.Post.id == tag_match_count_subq.c.post_id)
        .filter(
            models.Post.published.is_(True),
            models.Post.id != post_id,
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
        )
    )

    # Same category gets higher priority (add 100 to match_count).
    # coalesce() turns NULL match counts into 0 so posts sharing no tags still
    # rank below same-category matches (PostgreSQL orders NULLs first in DESC
    # by default, which inverted the intended ranking).
    if post.category_id:
        query = query.add_columns(
            case(
                (
                    models.Post.category_id == post.category_id,
                    func.coalesce(tag_match_count_subq.c.match_count, 0) + 100,
                ),
                else_=func.coalesce(tag_match_count_subq.c.match_count, 0),
            ).label("priority")
        )
        query = query.order_by(
            case(
                (
                    models.Post.category_id == post.category_id,
                    func.coalesce(tag_match_count_subq.c.match_count, 0) + 100,
                ),
                else_=func.coalesce(tag_match_count_subq.c.match_count, 0),
            ).desc(),
            models.Post.created_at.desc(),
        )
    else:
        query = query.order_by(
            tag_match_count_subq.c.match_count.desc().nullslast(),
            models.Post.created_at.desc(),
        )

    results = query.limit(limit).all()

    # Extract posts from results (strip the extra columns)
    posts = [row[0] for row in results]
    _populate_post_metrics(db, posts)
    return posts


def get_adjacent_posts(db: Session, post_id: int) -> tuple[models.Post | None, models.Post | None]:
    """Return the linear previous/next posts around `post_id` in public feed order.

    Feed order is pinned desc, then created_at desc (matching ``get_posts``), so
    "previous" is the post immediately above the current one and "next" is the
    one immediately below it when scanning the homepage feed. Only publicly
    visible (published, publish_at passed) posts count, matching the feed.

    Returns ``(previous, next)``; either side is None at the ends of the feed,
    and both are None when the post is not publicly visible.
    """
    now = utc_now_naive()
    # Fetch public post ids in exact feed order (single cheap column query),
    # find the current post's position, then load only the two neighbours with
    # their relationships. Avoids loading every post row for a small result.
    feed_ids = [
        row[0]
        for row in db.query(models.Post.id)
        .filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .order_by(models.Post.pinned.desc(), models.Post.created_at.desc())
        .all()
    ]
    try:
        idx = feed_ids.index(post_id)
    except ValueError:
        return None, None

    neighbour_ids = []
    if idx > 0:
        neighbour_ids.append(feed_ids[idx - 1])
    if idx + 1 < len(feed_ids):
        neighbour_ids.append(feed_ids[idx + 1])
    if not neighbour_ids:
        return None, None

    rows = (
        db.query(models.Post)
        .filter(models.Post.id.in_(neighbour_ids))
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .all()
    )
    by_id = {p.id: p for p in rows}
    _populate_post_metrics(db, list(by_id.values()))
    previous = by_id.get(feed_ids[idx - 1]) if idx > 0 else None
    following = by_id.get(feed_ids[idx + 1]) if idx + 1 < len(feed_ids) else None
    return previous, following


# --- Series (DEC-056, TASK-121) -------------------------------------------


def get_series(db: Session, series_id: int) -> models.Series | None:
    """Fetch a series by id."""
    return db.query(models.Series).filter(models.Series.id == series_id).first()


def get_series_by_slug(db: Session, slug: str) -> models.Series | None:
    """Fetch a series by its unique, stable slug."""
    return db.query(models.Series).filter(models.Series.slug == slug).first()


def list_series(db: Session) -> list[models.Series]:
    """All series, ordered by title for a stable, predictable admin/public list."""
    return db.query(models.Series).order_by(models.Series.title).all()


def count_visible_series_posts(db: Session, series_id: int) -> int:
    """Number of publicly visible posts in a series (drafts/scheduled excluded)."""
    now = utc_now_naive()
    return (
        db.query(models.Series.id)
        .join(models.Post, models.Post.series_id == models.Series.id)
        .filter(
            models.Series.id == series_id,
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .count()
    )


def get_series_visible_posts(db: Session, series: models.Series) -> list[models.Post]:
    """Ordered, publicly visible posts of a series (self-controlled order).

    Order is ``series_order`` then ``id`` (see Series.posts relationship) so
    equal orders resolve deterministically to insertion order. Drafts and
    scheduled-future posts are excluded, mirroring the public post list filter.
    """
    now = utc_now_naive()
    posts = (
        db.query(models.Post)
        .filter(
            models.Post.series_id == series.id,
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
        )
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .order_by(models.Post.series_order, models.Post.id)
        .all()
    )
    _populate_post_metrics(db, posts)
    return posts


def list_series_episodes(db: Session, series: models.Series) -> list[models.Post]:
    """All of a series' posts in order (admin view, any status incl. drafts).

    Order is ``series_order`` then ``id`` so equal orders resolve to insertion
    order (mirrors get_series_visible_posts).
    """
    return (
        db.query(models.Post)
        .filter(models.Post.series_id == series.id)
        .order_by(models.Post.series_order, models.Post.id)
        .all()
    )


def reorder_series_episodes(db: Session, series: models.Series, post_ids: list[int]) -> list[models.Post]:
    """Rewrite a series' episode order (1..n) from an explicit post-id list.

    Every id in ``post_ids`` must belong to the series, and the list must not
    contain duplicates, or a ValueError is raised before any write. Posts not
    listed keep their current series_order (they drop out of the ordered view
    only if no longer linked to the series). Returns the updated ordered posts.
    """
    if len(post_ids) != len(set(post_ids)):
        raise ValueError("Duplicate post ids in reorder")
    posts = []
    for pid in post_ids:
        post = db.get(models.Post, pid)
        if post is None or post.series_id != series.id:
            raise ValueError(f"Post {pid} is not part of this series")
        posts.append(post)
    for index, post in enumerate(posts):
        post.series_order = index + 1
    db.commit()
    for post in posts:
        db.refresh(post)
    return posts


def series_post_count(db: Session, series_id: int) -> int:
    """Total posts linked to a series (any status), for the admin episode view."""
    return db.query(models.Post).filter(models.Post.series_id == series_id).count()


def create_series(db: Session, data: schemas.SeriesCreate) -> models.Series:
    """Create a series. Raises ValueError on a duplicate slug."""
    db_series = models.Series(
        title=data.title,
        slug=data.slug,
        description=data.description,
    )
    db.add(db_series)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError(f"Series with slug '{data.slug}' already exists")
    db.refresh(db_series)
    clear_series_cache()
    return db_series


def update_series(db: Session, series_id: int, data: schemas.SeriesUpdate) -> models.Series | None:
    """Update a series (title/slug/description). None if the series is missing."""
    db_series = get_series(db, series_id)
    if not db_series:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(db_series, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError(f"Series with slug '{data.slug}' already exists")
    db.refresh(db_series)
    clear_series_cache()
    # Series identity is embedded in public post lists/feeds via SeriesBrief.
    clear_posts_list_cache()
    return db_series


def delete_series(db: Session, series_id: int) -> bool:
    """Delete a series, unlinking its posts (posts keep existing, series cleared)."""
    db_series = get_series(db, series_id)
    if not db_series:
        return False
    # Unlink posts first so the FK can't block the delete (no cascade on the
    # posts.series_id relation — deleting a series must never delete posts).
    db.query(models.Post).filter(models.Post.series_id == series_id).update(
        {models.Post.series_id: None, models.Post.series_order: 0}
    )
    db.delete(db_series)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete series: it has dependent records")
    clear_series_cache()
    clear_posts_list_cache()
    return True


# ---------------------------------------------------------------------------
# Reader bookmarks (cloud-synced, DEC-059/TASK-132)
# ---------------------------------------------------------------------------


def get_reader_bookmark(db: Session, reader_id: int, post_id: int) -> models.ReaderBookmark | None:
    """Return the reader's bookmark for a post, or None."""
    return (
        db.query(models.ReaderBookmark)
        .filter(
            models.ReaderBookmark.reader_id == reader_id,
            models.ReaderBookmark.post_id == post_id,
        )
        .first()
    )


def add_reader_bookmark(db: Session, reader_id: int, post_id: int) -> tuple[models.ReaderBookmark, bool]:
    """Create a bookmark; returns (bookmark, created). Idempotent: re-adding
    an existing bookmark returns the existing row with created=False (merge-
    friendly — a localStorage-first client re-PUTs the same set on login)."""
    existing = get_reader_bookmark(db, reader_id, post_id)
    if existing:
        return existing, False
    bookmark = models.ReaderBookmark(reader_id=reader_id, post_id=post_id)
    db.add(bookmark)
    db.commit()
    db.refresh(bookmark)
    return bookmark, True


def remove_reader_bookmark(db: Session, reader_id: int, post_id: int) -> bool:
    """Delete a bookmark; returns True if one was removed. Idempotent."""
    bookmark = get_reader_bookmark(db, reader_id, post_id)
    if not bookmark:
        return False
    db.delete(bookmark)
    db.commit()
    return True


def get_reading_history(db: Session, reader_id: int, post_id: int) -> models.ReadingHistory | None:
    """Return the reader's view-history row for a post, or None."""
    return (
        db.query(models.ReadingHistory)
        .filter(
            models.ReadingHistory.reader_id == reader_id,
            models.ReadingHistory.post_id == post_id,
        )
        .first()
    )


def record_reading_history(
    db: Session, reader_id: int, post_id: int, scroll_position: int | None = None
) -> tuple[models.ReadingHistory, bool]:
    """Upsert a view into the reader's history; returns (row, created).

    Idempotent: recording the same post again refreshes ``viewed_at`` in place
    (moving it to the front of the newest-first list) instead of duplicating —
    a reader revisiting a post bumps it, mirroring read-trail semantics
    (DEC-116, TASK-170).

    ``scroll_position`` (per-post resume, DEC-167/TASK-200) is updated in place
    *only* when the caller passes an explicit value: a plain view (None)
    preserves whatever position was last saved, so reopening a post does not
    wipe the reader's place. ``0`` is meaningful (scrolled back to the very
    top) and clears the saved offset.
    """
    existing = get_reading_history(db, reader_id, post_id)
    if existing:
        existing.viewed_at = datetime.now(UTC)
        if scroll_position is not None:
            existing.scroll_position = scroll_position
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing, False
    row = models.ReadingHistory(
        reader_id=reader_id,
        post_id=post_id,
        viewed_at=datetime.now(UTC),
        scroll_position=scroll_position,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, True


def list_reader_history(
    db: Session, reader_id: int, page: int = 1, limit: int = 20, q: str | None = None
) -> tuple[list[tuple[models.Post, datetime]], int]:
    """Return the reader's viewed posts (publicly visible only) newest-first.

    ``q`` (optional) filters to viewed posts whose title or excerpt matches the
    term (case-insensitive, escape-aware — DEC-148/TASK-186) so a reader can
    recall a past read.

    Paginated. Same non-leak invariant as bookmarks/subscriptions: a viewed post
    that was later un-published/scheduled simply stops appearing (the history row
    is kept; it reappears if the post becomes public again). Each item carries
    the post plus the last ``viewed_at`` so the UI can render when it was read.
    Visibility filtering, counting, and pagination all run in SQL so response
    cost is bounded by the requested page size.
    """
    filters = [
        models.ReadingHistory.reader_id == reader_id,
        models.ReadingHistory.viewed_at.is_not(None),
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= utc_now_naive()),
    ]
    if q and q.strip():
        term = f"%{escape_like_pattern(q.strip())}%"
        filters.append(
            or_(
                models.Post.title.ilike(term, escape="\\"),
                models.Post.excerpt.ilike(term, escape="\\"),
            )
        )

    total = int(
        db.query(func.count(models.ReadingHistory.id))
        .join(models.Post, models.ReadingHistory.post_id == models.Post.id)
        .filter(*filters)
        .scalar()
        or 0
    )
    query = (
        db.query(models.Post, models.ReadingHistory.viewed_at)
        .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
        .filter(*filters)
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
    )
    rows = (
        query.order_by(models.ReadingHistory.viewed_at.desc(), models.ReadingHistory.post_id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )
    page_items = []
    for post, viewed_at in rows:
        assert viewed_at is not None  # Enforced by the SQL filter above.
        page_items.append((post, viewed_at))
    return page_items, total


def clear_reader_history(db: Session, reader_id: int) -> int:
    """Delete every history row for a reader; returns the number removed."""
    deleted = db.query(models.ReadingHistory).filter(models.ReadingHistory.reader_id == reader_id).delete()
    db.commit()
    return deleted


# Reading-streak + activity window for the /history summary (DEC-169, TASK-201).
# The heatmap shows the last 52 weeks; entries are produced for every day
# (zeros included) so the frontend renders a complete calendar without gaps.
ACTIVITY_DAYS = 364


def _current_streak(dates: set) -> int:
    """Consecutive active days ending today (or yesterday while today is still
    inactive — a reader who has not read *yet* today keeps their streak)."""
    if not dates:
        return 0
    today = datetime.now(UTC).date()
    anchor = today if today in dates else today - timedelta(days=1)
    n = 0
    while anchor in dates:
        n += 1
        anchor -= timedelta(days=1)
    return n


def _longest_streak(dates: set) -> int:
    """Longest run of consecutive active days anywhere in the history."""
    if not dates:
        return 0
    longest = run = 0
    prev = None
    for d in sorted(dates):
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        longest = max(longest, run)
        prev = d
    return longest


def _day_activity(counts: dict) -> list[dict]:
    """Per-day read counts for the last ``ACTIVITY_DAYS`` days (UTC, ascending,
    zeros included) for a GitHub-style heatmap."""
    today = datetime.now(UTC).date()
    window_start = today - timedelta(days=ACTIVITY_DAYS - 1)
    out: list[dict] = []
    d = window_start
    while d <= today:
        out.append({"date": d.isoformat(), "count": counts.get(d, 0)})
        d += timedelta(days=1)
    return out


def reader_history_stats(db: Session, reader_id: int, recent_limit: int = 6) -> dict:
    """Aggregate a reader's reading summary from their history (DEC-118).

    Returns total visible posts read, the sum of their reading minutes, the
    most-recent viewed timestamp, and the ``recent_limit`` most recent
    (post, viewed_at) pairs. Since DEC-169/TASK-201 it also returns the
    current/longest reading streak and a 52-week per-day activity list for the
    gamification surface on /history. Uses the same public-visibility filter as
    the history list so un-published posts don't leak or count.
    """
    rows = (
        db.query(models.Post, models.ReadingHistory.viewed_at)
        .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
        .filter(models.ReadingHistory.reader_id == reader_id)
        .order_by(models.ReadingHistory.viewed_at.desc(), models.Post.id.desc())
        .all()
    )
    visible = [(post, viewed_at) for post, viewed_at in rows if is_publicly_visible(post)]
    total_minutes = sum(schemas.reading_minutes(post.content or "") for post, _ in visible)

    counts: dict = {}
    dates: set = set()
    for _post, viewed_at in visible:
        if viewed_at is None:
            continue
        d = viewed_at.date()
        counts[d] = counts.get(d, 0) + 1
        dates.add(d)

    return {
        "total_posts": len(visible),
        "total_reading_minutes": total_minutes,
        "last_viewed_at": visible[0][1] if visible else None,
        "recent": visible[:recent_limit],
        "current_streak": _current_streak(dates),
        "longest_streak": _longest_streak(dates),
        "activity": _day_activity(counts),
    }


def reader_series_progress(db: Session, reader_id: int, series: models.Series) -> dict:
    """Compute a reader's progress through a series from their history.

    ``posts`` is the series' ordered, publicly visible posts (series_order then
    id). A post counts as read when it appears in the reader's reading_history
    (server-backed trail, TASK-170). Returns total count, the read post ids,
    how many are read, the first *unread* post slug (None when complete), and a
    completion flag. Public-visibility invariants hold via get_series_visible_posts.
    (DEC-122/TASK-173)
    """
    posts = get_series_visible_posts(db, series)
    if not posts:
        return {
            "total": 0,
            "read_post_ids": [],
            "read_count": 0,
            "next_slug": None,
            "completed": False,
        }
    post_ids = [p.id for p in posts]
    read_rows = (
        db.query(models.ReadingHistory.post_id)
        .filter(
            models.ReadingHistory.reader_id == reader_id,
            models.ReadingHistory.post_id.in_(post_ids),
        )
        .all()
    )
    read_ids = {row.post_id for row in read_rows}
    next_slug = next((p.slug for p in posts if p.id not in read_ids), None)
    return {
        "total": len(posts),
        "read_post_ids": sorted(p.id for p in posts if p.id in read_ids),
        "read_count": len(read_ids),
        "next_slug": next_slug,
        "completed": next_slug is None and len(posts) > 0,
    }


def export_reader_data(db: Session, reader_id: int) -> dict:
    """Assemble a reader's portable data bundle (DEC-126/TASK-175).

    Scoped strictly to the caller: profile, public-visible bookmarks (with
    folder name), all of the reader's own comments (any moderation status),
    and their publicly-visible reading history. Nothing cross-reader and no
    draft/scheduled-post leakage — bookmarks/history exclude non-visible posts
    (same invariants as the read paths).
    """
    account = db.query(auth.ReaderAccount).filter(auth.ReaderAccount.id == reader_id).first()
    account_data = {
        "email": account.email if account else None,
        "display_name": account.display_name if account else None,
        "created_at": account.created_at.isoformat() if account and account.created_at else None,
    }

    bookmarks = []
    for post, _, folder_name in list_reader_bookmarks(db, reader_id):
        bookmarks.append(
            {
                "post_id": post.id,
                "title": post.title,
                "slug": post.slug,
                "folder_name": folder_name,
                "created_at": post.created_at.isoformat() if post.created_at else None,
            }
        )

    comments = []
    comment_rows = (
        db.query(models.Comment).filter(models.Comment.reader_id == reader_id).order_by(models.Comment.created_at).all()
    )
    for c in comment_rows:
        post = db.get(models.Post, c.post_id)
        if c.is_approved is True:
            status = "approved"
        elif c.reviewed_at is not None:
            status = "rejected"
        else:
            status = "pending"
        comments.append(
            {
                "comment_id": c.id,
                "post_id": c.post_id,
                "post_slug": post.slug if post else None,
                "content": c.content,
                "status": status,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "edited_at": c.edited_at.isoformat() if c.edited_at else None,
            }
        )

    history = []
    history_rows = (
        db.query(models.Post, models.ReadingHistory.viewed_at)
        .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
        .filter(models.ReadingHistory.reader_id == reader_id)
        .order_by(models.ReadingHistory.viewed_at.desc())
        .all()
    )
    for post, viewed_at in history_rows:
        if not is_publicly_visible(post):
            continue
        history.append(
            {
                "post_id": post.id,
                "title": post.title,
                "slug": post.slug,
                "viewed_at": viewed_at.isoformat() if viewed_at else None,
            }
        )

    return {
        "account": account_data,
        "exported_at": datetime.now(UTC).isoformat(),
        "bookmarks": bookmarks,
        "comments": comments,
        "history": history,
    }


def recommend_posts(db: Session, reader_id: int, limit: int = 6) -> list[models.Post]:
    """Personalized post recommendations from the reader's interests.

    Interest signal = the reader's publicly-visible reading history (TASK-170)
    plus bookmarks (TASK-132): category and tag weights are the number of known
    posts carrying each. Candidate posts are public posts the reader has
    *not* read or bookmarked; each is scored by its shared category (×10) and
    shared tags (×2), then ranked by score desc, recency desc, id desc for a
    stable ordering. Posts with zero affinity are dropped. Only posts with
    affinity are recommended, so a cold-start reader gets an empty list (the
    frontend hides the row). (DEC-128/TASK-176)
    """
    now = utc_now_naive()

    history_ids = [
        r.post_id
        for r in db.query(models.ReadingHistory.post_id).filter(models.ReadingHistory.reader_id == reader_id).all()
    ]
    bookmark_ids = [
        b.post_id
        for b in db.query(models.ReaderBookmark.post_id).filter(models.ReaderBookmark.reader_id == reader_id).all()
    ]
    known_ids = set(history_ids) | set(bookmark_ids)

    # Build interest weights from the reader's known (public) posts.
    category_weight: dict[int, int] = {}
    tag_weight: dict[int, int] = {}
    if known_ids:
        known_posts = (
            db.query(models.Post)
            .filter(models.Post.id.in_(list(known_ids)))
            .options(joinedload(models.Post.category), joinedload(models.Post.tags))
            .all()
        )
        for post in known_posts:
            if not is_publicly_visible(post):
                continue
            if post.category_id:
                category_weight[post.category_id] = category_weight.get(post.category_id, 0) + 1
            for tag in post.tags:
                tag_weight[tag.id] = tag_weight.get(tag.id, 0) + 1
    if not category_weight and not tag_weight:
        return []

    candidate_query = db.query(models.Post).filter(
        models.Post.published.is_(True),
        or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
    )
    if known_ids:
        candidate_query = candidate_query.filter(models.Post.id.notin_(list(known_ids)))
    candidates = candidate_query.options(joinedload(models.Post.category), joinedload(models.Post.tags)).all()

    def affinity(post: models.Post) -> int:
        score = 0
        if post.category_id:
            score += category_weight.get(post.category_id, 0) * 10
        for tag in post.tags:
            score += tag_weight.get(tag.id, 0) * 2
        return score

    scored = [(affinity(p), p) for p in candidates if is_publicly_visible(p) and affinity(p) > 0]
    scored.sort(
        key=lambda item: (
            -item[0],
            -(item[1].created_at or now).timestamp() if item[1].created_at else 0,
            -item[1].id,
        )
    )
    result = [post for _, post in scored[:limit]]
    _populate_post_metrics(db, result)
    return result


def get_series_follow(db: Session, reader_id: int, series_id: int) -> models.SeriesFollow | None:
    """Return the reader's follow for a series, or None."""
    return (
        db.query(models.SeriesFollow)
        .filter(models.SeriesFollow.reader_id == reader_id, models.SeriesFollow.series_id == series_id)
        .first()
    )


def add_series_follow(db: Session, reader_id: int, series_id: int) -> tuple[models.SeriesFollow, bool]:
    """Follow a series for new-part push; returns (follow, created). Idempotent."""
    existing = get_series_follow(db, reader_id, series_id)
    if existing:
        return existing, False
    follow = models.SeriesFollow(reader_id=reader_id, series_id=series_id)
    db.add(follow)
    db.commit()
    db.refresh(follow)
    return follow, True


def remove_series_follow(db: Session, reader_id: int, series_id: int) -> bool:
    """Unfollow a series; returns True if a follow was removed. Idempotent."""
    follow = get_series_follow(db, reader_id, series_id)
    if not follow:
        return False
    db.delete(follow)
    db.commit()
    return True


def set_series_follow_notify(db: Session, reader_id: int, series_id: int, notify: bool) -> models.SeriesFollow | None:
    """Toggle whether a follow pushes new-part notifications. Returns None if not following."""
    follow = get_series_follow(db, reader_id, series_id)
    if not follow:
        return None
    follow.notify = notify
    db.commit()
    db.refresh(follow)
    return follow


def list_reader_series_follows(db: Session, reader_id: int) -> list[models.SeriesFollow]:
    """The reader's follow rows (with ``series`` loaded), newest follow first."""
    rows = (
        db.query(models.SeriesFollow)
        .filter(models.SeriesFollow.reader_id == reader_id)
        .order_by(models.SeriesFollow.created_at.desc(), models.SeriesFollow.id.desc())
        .all()
    )
    return rows


def list_series_follow_reader_ids(db: Session, series_id: int) -> list[int]:
    """Reader ids following a series with notifications on (for 'new part' push dispatch)."""
    return [
        reader_id
        for (reader_id,) in db.query(models.SeriesFollow.reader_id)
        .filter(models.SeriesFollow.series_id == series_id, models.SeriesFollow.notify.is_(True))
        .all()
    ]


def get_category_follow(db: Session, reader_id: int, category_id: int) -> models.CategoryFollow | None:
    """Return the reader's follow for a category, or None."""
    return (
        db.query(models.CategoryFollow)
        .filter(
            models.CategoryFollow.reader_id == reader_id,
            models.CategoryFollow.category_id == category_id,
        )
        .first()
    )


def add_category_follow(db: Session, reader_id: int, category_id: int) -> tuple[models.CategoryFollow, bool]:
    """Follow a category for new-post push; returns (follow, created). Idempotent."""
    existing = get_category_follow(db, reader_id, category_id)
    if existing:
        return existing, False
    follow = models.CategoryFollow(reader_id=reader_id, category_id=category_id)
    db.add(follow)
    db.commit()
    db.refresh(follow)
    return follow, True


def remove_category_follow(db: Session, reader_id: int, category_id: int) -> bool:
    """Unfollow a category; returns True if a follow was removed. Idempotent."""
    follow = get_category_follow(db, reader_id, category_id)
    if not follow:
        return False
    db.delete(follow)
    db.commit()
    return True


def set_category_follow_notify(
    db: Session, reader_id: int, category_id: int, notify: bool
) -> models.CategoryFollow | None:
    """Toggle whether a category follow pushes new-posts. Returns None if not following."""
    follow = get_category_follow(db, reader_id, category_id)
    if not follow:
        return None
    follow.notify = notify
    db.commit()
    db.refresh(follow)
    return follow


def list_reader_category_follows(db: Session, reader_id: int) -> list[models.CategoryFollow]:
    """The reader's category follow rows (with ``category`` loaded), newest first."""
    rows = (
        db.query(models.CategoryFollow)
        .filter(models.CategoryFollow.reader_id == reader_id)
        .order_by(models.CategoryFollow.created_at.desc(), models.CategoryFollow.id.desc())
        .all()
    )
    return rows


def list_category_follow_reader_ids(db: Session, category_id: int) -> list[int]:
    """Reader ids following a category with notifications on (for new-post dispatch)."""
    return [
        reader_id
        for (reader_id,) in db.query(models.CategoryFollow.reader_id)
        .filter(
            models.CategoryFollow.category_id == category_id,
            models.CategoryFollow.notify.is_(True),
        )
        .all()
    ]


def get_tag_follow(db: Session, reader_id: int, tag_id: int) -> models.TagFollow | None:
    """Return the reader's follow for a tag, or None."""
    return (
        db.query(models.TagFollow)
        .filter(
            models.TagFollow.reader_id == reader_id,
            models.TagFollow.tag_id == tag_id,
        )
        .first()
    )


def add_tag_follow(db: Session, reader_id: int, tag_id: int) -> tuple[models.TagFollow, bool]:
    """Follow a tag for new-post push; returns (follow, created). Idempotent."""
    existing = get_tag_follow(db, reader_id, tag_id)
    if existing:
        return existing, False
    follow = models.TagFollow(reader_id=reader_id, tag_id=tag_id)
    db.add(follow)
    db.commit()
    db.refresh(follow)
    return follow, True


def remove_tag_follow(db: Session, reader_id: int, tag_id: int) -> bool:
    """Unfollow a tag; returns True if a follow was removed. Idempotent."""
    follow = get_tag_follow(db, reader_id, tag_id)
    if not follow:
        return False
    db.delete(follow)
    db.commit()
    return True


def set_tag_follow_notify(db: Session, reader_id: int, tag_id: int, notify: bool) -> models.TagFollow | None:
    """Toggle whether a tag follow pushes new-posts. Returns None if not following."""
    follow = get_tag_follow(db, reader_id, tag_id)
    if not follow:
        return None
    follow.notify = notify
    db.commit()
    db.refresh(follow)
    return follow


def list_reader_tag_follows(db: Session, reader_id: int) -> list[models.TagFollow]:
    """The reader's tag follow rows (with ``tag`` loaded), newest first."""
    rows = (
        db.query(models.TagFollow)
        .filter(models.TagFollow.reader_id == reader_id)
        .options(joinedload(models.TagFollow.tag))
        .order_by(models.TagFollow.created_at.desc(), models.TagFollow.id.desc())
        .all()
    )
    return rows


def list_tag_follow_reader_ids(db: Session, tag_ids: list[int]) -> list[int]:
    """Reader ids following any of a post's tags with notifications on (new-post dispatch).

    Takes the post's whole tag set so the caller makes one query per post rather
    than one per tag; the union is deduped into a set downstream.
    """
    if not tag_ids:
        return []
    return [
        reader_id
        for (reader_id,) in db.query(models.TagFollow.reader_id)
        .filter(
            models.TagFollow.tag_id.in_(tag_ids),
            models.TagFollow.notify.is_(True),
        )
        .all()
    ]


def follows_feed_posts(db: Session, reader_id: int, limit: int = 12) -> list[models.Post]:
    """Recent public posts from the reader's followed categories + series + tags.

    The discovery payoff of the follow model (DEC-142/TASK-183; tag dimension
    DEC-195/TASK-215): a post matches if its category is one the reader follows
    OR its series is one they follow OR it carries a tag they follow
    (independent of per-follow notify — tracking, not push). Results are
    public, published, deduped (a post is its own row), newest first, capped at
    ``limit``. A reader following nothing gets an empty list (the frontend
    hides the row).
    """
    category_ids = [
        cid
        for (cid,) in db.query(models.CategoryFollow.category_id)
        .filter(models.CategoryFollow.reader_id == reader_id)
        .all()
    ]
    series_ids = [
        sid
        for (sid,) in db.query(models.SeriesFollow.series_id).filter(models.SeriesFollow.reader_id == reader_id).all()
    ]
    tag_ids = [
        tid for (tid,) in db.query(models.TagFollow.tag_id).filter(models.TagFollow.reader_id == reader_id).all()
    ]
    if not category_ids and not series_ids and not tag_ids:
        return []

    now = utc_now_naive()
    scope = []
    if category_ids:
        scope.append(models.Post.category_id.in_(category_ids))
    if series_ids:
        scope.append(models.Post.series_id.in_(series_ids))
    if tag_ids:
        scope.append(
            models.Post.id.in_(db.query(models.post_tags.c.post_id).filter(models.post_tags.c.tag_id.in_(tag_ids)))
        )

    query = (
        db.query(models.Post)
        .filter(
            models.Post.published.is_(True),
            or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now),
            or_(*scope),
        )
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .order_by(models.Post.created_at.desc(), models.Post.id.desc())
        .limit(limit)
    )
    result = [post for post in query.all() if is_publicly_visible(post)]
    _populate_post_metrics(db, result)
    return result


def get_follow_stats(db: Session, limit: int = 5) -> dict:
    """Operator-facing follow analytics (DEC-144, TASK-184).

    Counts are notify-independent (tracking, not push): they capture how many
    readers follow each series and category, plus totals, so the author can see
    what readers track. Top-N are ordered by follower count desc, then id desc
    for stable ordering.
    """
    series_rows = (
        db.query(models.SeriesFollow.series_id, func.count(models.SeriesFollow.id))
        .group_by(models.SeriesFollow.series_id)
        .order_by(func.count(models.SeriesFollow.id).desc(), models.SeriesFollow.series_id.desc())
        .limit(limit)
        .all()
    )
    category_rows = (
        db.query(models.CategoryFollow.category_id, func.count(models.CategoryFollow.id))
        .group_by(models.CategoryFollow.category_id)
        .order_by(func.count(models.CategoryFollow.id).desc(), models.CategoryFollow.category_id.desc())
        .limit(limit)
        .all()
    )
    total_series = db.query(func.count(models.SeriesFollow.id)).scalar() or 0
    total_categories = db.query(func.count(models.CategoryFollow.id)).scalar() or 0

    series_ids = [sid for sid, _ in series_rows]
    series_map = (
        {s.id: s for s in db.query(models.Series).filter(models.Series.id.in_(series_ids)).all()} if series_ids else {}
    )

    category_ids = [cid for cid, _ in category_rows]
    category_map = (
        {c.id: c for c in db.query(models.Category).filter(models.Category.id.in_(category_ids)).all()}
        if category_ids
        else {}
    )

    return {
        "total_series_follows": total_series,
        "total_category_follows": total_categories,
        "top_series": [
            {
                "id": sid,
                "title": series_map[sid].title if sid in series_map else str(sid),
                "slug": series_map[sid].slug if sid in series_map else "",
                "count": count,
            }
            for sid, count in series_rows
        ],
        "top_categories": [
            {
                "id": cid,
                "name": category_map[cid].name if cid in category_map else str(cid),
                "count": count,
            }
            for cid, count in category_rows
        ],
    }


def log_search_query(db: Session, query: str | None) -> None:
    """Best-effort aggregate of a public search term (DEC-152/TASK-188).

    Normalizes to lowercased, trimmed (≤200 chars) and upserts a counter on the
    matching row. Never tied to a reader. A logging failure is swallowed — it
    must never break search.
    """
    q = (query or "").strip().lower()[:200]
    if not q:
        return
    now = datetime.now(UTC)
    row = db.query(models.SearchLog).filter(models.SearchLog.query == q).first()
    if row:
        row.count = (row.count or 0) + 1
        row.last_searched_at = now
    else:
        db.add(models.SearchLog(query=q, count=1, last_searched_at=now))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        row = db.query(models.SearchLog).filter(models.SearchLog.query == q).first()
        if row:
            row.count = (row.count or 0) + 1
            row.last_searched_at = now
            db.commit()


def get_top_searches(db: Session, limit: int = 10) -> list[dict]:
    """Top public search terms by aggregate count, newest-searched tiebreak."""
    rows = (
        db.query(models.SearchLog.query, models.SearchLog.count)
        .order_by(models.SearchLog.count.desc(), models.SearchLog.last_searched_at.desc())
        .limit(limit)
        .all()
    )
    return [{"query": q, "count": c} for q, c in rows]


def list_reader_bookmarks(
    db: Session, reader_id: int, folder_id: int | None = None
) -> list[tuple[models.Post, int | None, str | None]]:
    """Return the reader's bookmark rows as (post, folder_id, folder_name),
    publicly-visible only, newest bookmark first.

    Post timestamps/visibility can change after a bookmark is saved; the list
    must not leak a draft or scheduled post on a read path (same invariant as
    the public post/comment read paths). Non-visible posts simply don't appear.
    ``folder_id`` (if given) filters to that folder. (DEC-120/TASK-172)
    """
    query = (
        db.query(models.Post, models.ReaderBookmark.folder_id, models.BookmarkFolder.name)
        .join(models.ReaderBookmark, models.ReaderBookmark.post_id == models.Post.id)
        .outerjoin(models.BookmarkFolder, models.ReaderBookmark.folder_id == models.BookmarkFolder.id)
        .filter(models.ReaderBookmark.reader_id == reader_id)
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .order_by(models.ReaderBookmark.created_at.desc(), models.Post.id.desc())
    )
    if folder_id is not None:
        query = query.filter(models.ReaderBookmark.folder_id == folder_id)
    rows = query.all()
    return [(post, fid, fname) for post, fid, fname in rows if is_publicly_visible(post)]


# Bookmark folders/collections (DEC-120/TASK-172)
# ---------------------------------------------------------------------------


def get_bookmark_folder(db: Session, reader_id: int, folder_id: int) -> models.BookmarkFolder | None:
    """Return one of the reader's folders (ownership-scoped), or None."""
    return (
        db.query(models.BookmarkFolder)
        .filter(
            models.BookmarkFolder.id == folder_id,
            models.BookmarkFolder.reader_id == reader_id,
        )
        .first()
    )


def list_reader_bookmark_folders(db: Session, reader_id: int) -> list[tuple[models.BookmarkFolder, int]]:
    """Return (folder, bookmark_count) for the reader's folders, name asc."""
    rows = (
        db.query(models.BookmarkFolder, func.count(models.ReaderBookmark.id))
        .outerjoin(
            models.ReaderBookmark,
            and_(
                models.ReaderBookmark.folder_id == models.BookmarkFolder.id,
                models.ReaderBookmark.reader_id == reader_id,
            ),
        )
        .filter(models.BookmarkFolder.reader_id == reader_id)
        .group_by(models.BookmarkFolder.id)
        .order_by(models.BookmarkFolder.name.asc())
        .all()
    )
    return [(folder, count) for folder, count in rows]


def create_bookmark_folder(db: Session, reader_id: int, name: str) -> tuple[models.BookmarkFolder, bool]:
    """Create a folder; returns (folder, created). Idempotent: a folder with
    the same name already existing returns it with created=False."""
    name = name.strip()
    existing = (
        db.query(models.BookmarkFolder)
        .filter(models.BookmarkFolder.reader_id == reader_id, models.BookmarkFolder.name == name)
        .first()
    )
    if existing:
        return existing, False
    folder = models.BookmarkFolder(reader_id=reader_id, name=name)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder, True


def rename_bookmark_folder(db: Session, reader_id: int, folder_id: int, name: str) -> models.BookmarkFolder | None:
    """Rename a folder; returns the folder, or None if not found or the new
    name collides with another of the reader's folders."""
    folder = get_bookmark_folder(db, reader_id, folder_id)
    if not folder:
        return None
    name = name.strip()
    if name != folder.name:
        dup = (
            db.query(models.BookmarkFolder)
            .filter(
                models.BookmarkFolder.reader_id == reader_id,
                models.BookmarkFolder.name == name,
                models.BookmarkFolder.id != folder_id,
            )
            .first()
        )
        if dup:
            return None
    folder.name = name
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


def delete_bookmark_folder(db: Session, reader_id: int, folder_id: int) -> bool:
    """Delete a folder; unassigns its bookmarks (sets folder_id=None).
    Returns True if a folder was removed, False if not found. Idempotent."""
    folder = get_bookmark_folder(db, reader_id, folder_id)
    if not folder:
        return False
    db.query(models.ReaderBookmark).filter(
        models.ReaderBookmark.folder_id == folder_id,
        models.ReaderBookmark.reader_id == reader_id,
    ).update({"folder_id": None})
    db.delete(folder)
    db.commit()
    return True


def set_bookmark_folder(
    db: Session, reader_id: int, post_id: int, folder_id: int | None
) -> models.ReaderBookmark | None:
    """File a bookmark into a folder (or clear it with folder_id=None).
    Ownership-scoped: the folder must belong to the reader. Returns the
    updated bookmark, or None if the bookmark doesn't exist or the folder is
    not the reader's."""
    bookmark = get_reader_bookmark(db, reader_id, post_id)
    if not bookmark:
        return None
    if folder_id is not None and not get_bookmark_folder(db, reader_id, folder_id):
        return None
    bookmark.folder_id = folder_id
    db.add(bookmark)
    db.commit()
    db.refresh(bookmark)
    return bookmark


def get_comment_subscription(db: Session, reader_id: int, post_id: int) -> models.CommentSubscription | None:
    """Return the reader's thread subscription for a post, or None."""
    return (
        db.query(models.CommentSubscription)
        .filter(
            models.CommentSubscription.reader_id == reader_id,
            models.CommentSubscription.post_id == post_id,
        )
        .first()
    )


def add_comment_subscription(db: Session, reader_id: int, post_id: int) -> tuple[models.CommentSubscription, bool]:
    """Follow a post's comment thread; returns (subscription, created).

    Idempotent: re-subscribing an existing follow returns the existing row
    with created=False (mirrors add_reader_bookmark's merge-friendly contract).
    """
    existing = get_comment_subscription(db, reader_id, post_id)
    if existing:
        return existing, False
    subscription = models.CommentSubscription(reader_id=reader_id, post_id=post_id)
    db.add(subscription)
    db.commit()
    db.refresh(subscription)
    return subscription, True


def remove_comment_subscription(db: Session, reader_id: int, post_id: int) -> bool:
    """Unfollow a post's comment thread; returns True if one was removed."""
    subscription = get_comment_subscription(db, reader_id, post_id)
    if not subscription:
        return False
    db.delete(subscription)
    db.commit()
    return True


def list_reader_comment_subscriptions(db: Session, reader_id: int) -> list[models.Post]:
    """The posts whose threads a reader follows, *publicly visible* only.

    Same invariant as list_reader_bookmarks: a followed post that became a
    draft/private/scheduled must not leak on this read path — it simply stops
    appearing (the follow row is kept; the reader can re-see it, and
    unsubscribe, once the post is public again). Newest follow first.
    """
    rows = (
        db.query(models.Post)
        .join(models.CommentSubscription, models.CommentSubscription.post_id == models.Post.id)
        .filter(models.CommentSubscription.reader_id == reader_id)
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .order_by(models.CommentSubscription.created_at.desc())
        .all()
    )
    return [p for p in rows if is_publicly_visible(p)]


def comment_subscription_reader_ids(db: Session, post_id: int) -> list[int]:
    """Distinct reader_ids following a post's comment thread (fan-out target).

    Deduplicates in SQL in case future rows ever violate the ORM guard; the
    caller subtracts the comment author's own reader_id before dispatching.
    """
    return [
        row[0]
        for row in db.query(models.CommentSubscription.reader_id)
        .filter(models.CommentSubscription.post_id == post_id)
        .distinct()
        .all()
    ]


def get_reader_comments(
    db: Session,
    reader_id: int,
    status: str = "all",
    page: int = 1,
    limit: int = 20,
) -> tuple[list[models.Comment], int]:
    """A reader's own comments, newest first, with status filter + pagination.

    DEC-066/TASK-139 showed pending/rejected comments to their author (with a
    derived status); DEC-102/TASK-163 adds a status filter (all|pending|
    approved|rejected) and pagination so a reader with a long history can find
    pending/rejected items and page through. Public read paths still filter to
    approved only.

    Returns:
        Tuple of (page of comments, total count matching the filter).
    """
    query = db.query(models.Comment).filter(models.Comment.reader_id == reader_id)
    if status == "approved":
        query = query.filter(models.Comment.is_approved == True)  # noqa: E712
    elif status == "rejected":
        query = query.filter(
            models.Comment.is_approved == False,  # noqa: E712
            models.Comment.reviewed_at.isnot(None),
        )
    elif status == "pending":
        query = query.filter(
            models.Comment.is_approved == False,  # noqa: E712
            models.Comment.reviewed_at.is_(None),
        )
    # "all" -> no filter

    total = query.count()
    items = query.order_by(models.Comment.created_at.desc()).offset((page - 1) * limit).limit(limit).all()
    return items, total


# ---------------------------------------------------------------------------
# Site settings (DEC-100, TASK-162): operator-controlled runtime key/values.
# ---------------------------------------------------------------------------


def delete_reader_account(db: Session, reader_id: int) -> bool:
    """Permanently delete a reader account and detach their contributed data.

    Self-service account deletion (DEC-106, TASK-165): the comment *discussion*
    is preserved but anonymized (reader_id detached, keeping the stored
    nickname/content public but no longer account-linked — no verified badge),
    while the reader's cloud-synced bookmarks, comment-thread subscriptions and
    push subscriptions are removed. Returns False if the account does not exist.
    """
    reader = db.get(auth.ReaderAccount, reader_id)
    if reader is None:
        return False

    # Anonymize the reader's comments instead of deleting them, so a public
    # thread isn't destroyed by an account leaving (identity detached; the row
    # keeps its nickname/content, so it renders without the verified badge).
    db.query(models.Comment).filter(models.Comment.reader_id == reader_id).update(
        {models.Comment.reader_id: None},
        synchronize_session=False,
    )
    # Cloud-synced bookmarks and per-account subscriptions are account-private:
    # remove them outright.
    db.query(models.ReaderBookmark).filter(models.ReaderBookmark.reader_id == reader_id).delete(
        synchronize_session=False
    )
    db.query(models.CommentSubscription).filter(models.CommentSubscription.reader_id == reader_id).delete(
        synchronize_session=False
    )
    db.query(models.PushSubscription).filter(models.PushSubscription.reader_id == reader_id).delete(
        synchronize_session=False
    )
    db.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == reader_id).delete(
        synchronize_session=False
    )
    db.delete(reader)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete account: it has dependent records")
    return True


# ---- Reader notification inbox (DEC-160, TASK-192) ------------------------

# Retention cap per reader: keep the most recent N notifications, pruning older
# rows on insert so the inbox can never grow without bound (mirrors the per-post
# revision cap, DEC-158).
MAX_NOTIFICATIONS_PER_READER = 200


def _prune_notifications_for_readers(db: Session, reader_ids: set[int]) -> None:
    """Keep only the newest ``MAX_NOTIFICATIONS_PER_READER`` rows per reader.

    One set-based DELETE over a window function (ROW_NUMBER partitioned by
    reader, ordered by id desc) — portable across SQLite and PostgreSQL. This
    is the batched replacement for ``record_reader_notification``'s
    per-reader "SELECT recent-N + DELETE", which was O(2n) queries in the
    new-post fan-out (ISS-113, supersedes DEC-176's deferral): a heavily
    followed post now pays one delete instead of one per follower. Rows
    just inserted carry the highest ids, so they always rank inside the kept
    window (a fan-out adds at most one row per reader).
    """
    if not reader_ids:
        return
    ranked = (
        select(
            models.ReaderNotification.id,
            func.row_number()
            .over(
                partition_by=models.ReaderNotification.reader_id,
                order_by=models.ReaderNotification.id.desc(),
            )
            .label("rn"),
        ).where(models.ReaderNotification.reader_id.in_(reader_ids))
    ).subquery()
    over_cap = select(ranked.c.id).where(ranked.c.rn > MAX_NOTIFICATIONS_PER_READER)
    db.query(models.ReaderNotification).filter(models.ReaderNotification.id.in_(over_cap)).delete(
        synchronize_session=False
    )


def record_reader_notification(
    db: Session,
    reader_id: int,
    kind: str,
    title: str,
    body: str | None = None,
    url: str | None = None,
) -> models.ReaderNotification:
    """Persist one reader-facing notification row (inbox, DEC-160/TASK-192).

    Called at the same dispatch points that fire the Web Push (new post in a
    followed series/category, reply, thread comment) so the durable inbox and
    the ephemeral push stay in sync. Best effort: never raises — a notify path
    must not break the triggering write (publish/comment) because of persistence.
    """
    row = models.ReaderNotification(
        reader_id=reader_id,
        kind=kind,
        title=title,
        body=body,
        url=url,
    )
    try:
        db.add(row)
        db.flush()
        # Prune to the retention cap (keep newest by id).
        recent_ids = [
            rid
            for (rid,) in db.query(models.ReaderNotification.id)
            .filter(models.ReaderNotification.reader_id == reader_id)
            .order_by(models.ReaderNotification.id.desc())
            .limit(MAX_NOTIFICATIONS_PER_READER)
            .all()
        ]
        if recent_ids:
            db.query(models.ReaderNotification).filter(
                models.ReaderNotification.reader_id == reader_id,
                models.ReaderNotification.id.notin_(recent_ids),
            ).delete(synchronize_session=False)
        db.commit()
    except Exception:  # noqa: BLE001 — best effort, never fail the caller
        db.rollback()
    return row


def record_new_post_notifications(db: Session, post: models.Post) -> None:
    """Persist a new-post inbox notification for every reader who follows the
    post's series or category (DEC-160, TASK-192).

    Mirrors the follower targeting of ``dispatch_new_post`` (series followers +
    category followers + tag followers with notify on), but persists to the
    durable inbox instead of (or in addition to) the ephemeral browser push.
    Independent of VAPID configuration: a reader should still get an inbox row
    even when Web Push is not set up. Best effort, never raises. ``post`` must
    be the just-persisted, publicly-visible post (callers gate on
    ``is_publicly_visible``).

    Kind (ISS-114, DEC-181): a series follow surfaces the distinct
    ``series_new_part`` kind (frontend icons/labels it 系列更新) while a
    category-only (or tag-only) follow keeps ``new_post`` (新文章发布). A
    reader following both the series AND the category/tag of the same post gets
    exactly one row, preferring ``series_new_part`` — the series follow is the
    more specific signal for the same event. Tag followers (DEC-195/TASK-215)
    join under the same ``new_post`` umbrella. Both kinds stay gated by the
    single ``new_post`` opt-out (DEC-171 umbrella): a series update IS a new
    post, so a reader who silenced new_post is not woken for series parts.
    """
    try:
        series_reader_ids: set[int] = set()
        category_reader_ids: set[int] = set()
        tag_reader_ids: set[int] = set()
        # Readers who follow this post's series ('new part' notification).
        if post.series_id is not None:
            series_reader_ids.update(
                rid
                for (rid,) in db.query(models.SeriesFollow.reader_id)
                .filter(
                    models.SeriesFollow.series_id == post.series_id,
                    models.SeriesFollow.notify.is_(True),
                )
                .all()
            )
        # Readers who follow this post's category with notifications on.
        if post.category_id is not None:
            category_reader_ids.update(
                rid
                for (rid,) in db.query(models.CategoryFollow.reader_id)
                .filter(
                    models.CategoryFollow.category_id == post.category_id,
                    models.CategoryFollow.notify.is_(True),
                )
                .all()
            )
        # Readers who follow any of this post's tags with notifications on
        # (DEC-195/TASK-215). One query for the whole tag set.
        tag_ids = [t.id for t in (post.tags or [])]
        if tag_ids:
            tag_reader_ids.update(list_tag_follow_reader_ids(db, tag_ids))
        target_reader_ids = series_reader_ids | category_reader_ids | tag_reader_ids
        # Per-kind opt-out (DEC-171, TASK-202): batch-load every target's prefs
        # once. The same reader-level intent gates the push in
        # webpush.dispatch_new_post (which also reaches want_new_posts push
        # subscriptions with no follow), so an opted-out reader gets neither an
        # inbox row here nor a new_post push.
        prefs = reader_notification_prefs_for(db, target_reader_ids)
        # Batch the fan-out (ISS-113, supersedes DEC-176): build every row up
        # front, add all with one flush + one commit, then prune the whole
        # inbox retention cap for all touched readers with a single set-based
        # window-function delete — instead of record_reader_notification's
        # per-reader SELECT-recent-200 + DELETE + commit (O(2n) queries per
        # publish on a heavily followed post). The single commit also makes the
        # fan-out atomic: either every follower's inbox row lands or none does.
        rows: list[models.ReaderNotification] = []
        email_items: list[EmailItem] = []
        for reader_id in target_reader_ids:
            if not notification_kind_enabled(prefs.get(reader_id), "new_post"):
                continue
            is_series_part = reader_id in series_reader_ids
            kind = "series_new_part" if is_series_part else "new_post"
            title = "系列更新" if is_series_part else "新文章发布"
            rows.append(
                models.ReaderNotification(
                    reader_id=reader_id,
                    kind=kind,
                    title=title,
                    body=f"《{post.title or ''}》",
                    url=f"/posts/{post.slug}",
                )
            )
            # Email channel (DEC-197, TASK-217): a best-effort off-site copy of
            # the same fan-out, only for readers who opted into email for the kind.
            if email_channel_enabled(prefs.get(reader_id), kind):
                email_items.append(
                    EmailItem(
                        reader_id=reader_id,
                        kind=kind,
                        title=title,
                        body=f"《{post.title or ''}》",
                        url=f"/posts/{post.slug}",
                    )
                )
        if rows:
            db.add_all(rows)
            db.flush()  # assign ids so the prune's id ordering is exact
            _prune_notifications_for_readers(db, {r.reader_id for r in rows})
            db.commit()  # inserts + prune land atomically
        # Send after the inbox commit so a mail failure can't affect the durable
        # rows; dispatch_notification_emails never raises (best effort).
        dispatch_notification_emails(db, email_items, logger)
    except Exception:  # noqa: BLE001 — best effort, never fail the publish
        db.rollback()


# Notification-kind opt-outs (DEC-171, TASK-202). The preferences surface
# exposes exactly these toggles. Dispatch can also produce series_new_part as a
# label refinement of new_post (ISS-114, DEC-181) — it is never a separate
# toggle because a series update IS a new post; the new_post kill-switch gates
# it.
NOTIFICATION_KINDS: tuple[str, ...] = ("new_post", "reply", "thread_comment")
# Email channel (DEC-197, TASK-217): per-kind opt-ins accepted by the same
# PATCH endpoint. The fan-out gating for these lives in emailer.email_channel_enabled.
# email_weekly_digest (DEC-201, TASK-222) is the recurring digest opt-in — same
# toggle surface, but not a fan-out kind (the digest job reads it directly).
EMAIL_KINDS: tuple[str, ...] = ("email_new_post", "email_reply", "email_thread_comment", "email_weekly_digest")
PREF_KINDS: tuple[str, ...] = NOTIFICATION_KINDS + EMAIL_KINDS


def get_reader_notification_prefs(db: Session, reader_id: int) -> models.ReaderNotificationPref:
    """The reader's per-kind notification prefs, materializing an all-on row
    the first time it is read (GET). Dispatch gating must NOT call this — it
    writes; use ``reader_notification_prefs_for`` for fan-out paths.
    (DEC-171, TASK-202)
    """
    row = db.get(models.ReaderNotificationPref, reader_id)
    if row is None:
        row = models.ReaderNotificationPref(reader_id=reader_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def reader_notification_prefs_for(
    db: Session, reader_ids: Iterable[int]
) -> dict[int, models.ReaderNotificationPref | None]:
    """Batch pref lookup for dispatch gating — read-only, never writes.

    Returns {reader_id: pref_row}. Missing readers are absent (treat as all-on
    via ``notification_kind_enabled``), so a reader who never opted out keeps
    getting every kind without materializing a row in hot fan-out paths.
    (DEC-171, TASK-202)
    """
    ids = list(reader_ids)
    if not ids:
        return {}
    rows = db.query(models.ReaderNotificationPref).filter(models.ReaderNotificationPref.reader_id.in_(ids)).all()
    return {r.reader_id: r for r in rows}


def notification_kind_enabled(pref: models.ReaderNotificationPref | None, kind: str) -> bool:
    """True when a reader allows ``kind`` to fan out. A missing pref row (None)
    reads as enabled — defaults are all-on. Callers pass the row from
    ``reader_notification_prefs_for``. (DEC-171, TASK-202)
    """
    if pref is None:
        return True
    return bool(getattr(pref, kind, True))


def set_reader_notification_kind(
    db: Session, reader_id: int, kind: str, enabled: bool
) -> models.ReaderNotificationPref | None:
    """Toggle one notification kind for a reader; returns the updated row.

    ``kind`` must be in ``PREF_KINDS`` (whitelist — never write an
    attacker-controlled attribute). None if the kind is rejected; the router
    422s on that. (DEC-171, TASK-202; email channel DEC-197)
    """
    if kind not in PREF_KINDS:
        return None
    row = db.get(models.ReaderNotificationPref, reader_id)
    if row is None:
        row = models.ReaderNotificationPref(reader_id=reader_id)
        db.add(row)
    setattr(row, kind, enabled)
    row.updated_at = utc_now_naive()
    db.commit()
    db.refresh(row)
    return row


def list_reader_notifications(
    db: Session, reader_id: int, page: int = 1, limit: int = 20, unread_only: bool = False
) -> tuple[list[models.ReaderNotification], int]:
    """The reader's notification inbox rows, newest first, paginated.

    ``unread_only`` filters to rows with read_at NULL (for an unread badge).
    Returns (items, total). Unlike the post lists, inbox rows do not carry a
    public-visibility check — a notification points at a post that may later be
    unpublished, but the inbox records the *event*, not current visibility.
    """
    query = db.query(models.ReaderNotification).filter(models.ReaderNotification.reader_id == reader_id)
    if unread_only:
        query = query.filter(models.ReaderNotification.read_at.is_(None))
    total = query.count()
    items = query.order_by(models.ReaderNotification.id.desc()).offset((page - 1) * limit).limit(limit).all()
    return items, total


def unread_notification_count(db: Session, reader_id: int) -> int:
    """How many of the reader's notifications are unread (for a badge)."""
    return (
        db.query(models.ReaderNotification)
        .filter(
            models.ReaderNotification.reader_id == reader_id,
            models.ReaderNotification.read_at.is_(None),
        )
        .count()
    )


def mark_reader_notification_read(db: Session, reader_id: int, notification_id: int) -> bool:
    """Mark one of the reader's notifications read. Returns False if not theirs."""
    row = (
        db.query(models.ReaderNotification)
        .filter(
            models.ReaderNotification.id == notification_id,
            models.ReaderNotification.reader_id == reader_id,
        )
        .first()
    )
    if row is None:
        return False
    if row.read_at is None:
        row.read_at = utc_now_naive()
        db.commit()
    return True


def mark_all_reader_notifications_read(db: Session, reader_id: int) -> int:
    """Mark every unread notification of a reader read; returns count updated."""
    updated = (
        db.query(models.ReaderNotification)
        .filter(
            models.ReaderNotification.reader_id == reader_id,
            models.ReaderNotification.read_at.is_(None),
        )
        .update({models.ReaderNotification.read_at: utc_now_naive()}, synchronize_session=False)
    )
    db.commit()
    return updated


def get_site_setting(db: Session, key: str) -> str | None:
    """Read a persisted site setting by key, or None if it has never been set."""
    row = db.get(models.SiteSetting, key)
    return row.value if row is not None else None


def upsert_site_setting(db: Session, key: str, value: str) -> models.SiteSetting:
    """Persist (insert or overwrite) a site setting, returning the row."""
    row = db.get(models.SiteSetting, key)
    if row is None:
        row = models.SiteSetting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    db.commit()
    db.refresh(row)
    return row


def boolean_setting(db: Session, key: str, env_fallback: bool) -> bool:
    """Resolve a boolean site setting: persisted value wins, else env fallback.

    ``env_fallback`` is the operator's env default (e.g. the
    AUTO_APPROVE_READER_COMMENTS flag); a persisted row overrides it so the admin
    can flip policy at runtime (DEC-100, TASK-162)."""
    raw = get_site_setting(db, key)
    if raw is None:
        return env_fallback
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# ---------------------------------------------------------------------------
# Full-blog backup & restore (DEC-082, TASK-153)
# ---------------------------------------------------------------------------


def _iso(value: datetime | None) -> str | None:
    """ISO-8601 of a (possibly aware) datetime, or None."""
    return value.isoformat() if value is not None else None


def _from_iso(value: str | None) -> datetime | None:
    """Round-trip an exported ISO string (aware or naive), or None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def build_backup_snapshot(db: Session) -> dict:
    """Serialize the whole blog into a portable JSON snapshot (DEC-082).

    Content only: categories, tags, series, posts (with their category/tags/
    series links, view/like counters) and each post's comment threads, parents
    referenced by their export ordinal. Deliberately EXCLUDES auth data —
    admin users, reader accounts and their password hashes, browser push
    subscriptions — so a backup never carries a credential. Reader-attributed
    comments are exported with a ``reader`` marker; on restore they degrade to
    anonymous because reader accounts don't round-trip.
    """
    categories = [{"name": c.name} for c in db.query(models.Category).order_by(models.Category.name).all()]
    tags = [{"name": t.name} for t in db.query(models.Tag).order_by(models.Tag.name).all()]
    series = [
        {"title": s.title, "slug": s.slug, "description": s.description}
        for s in db.query(models.Series).order_by(models.Series.slug).all()
    ]
    posts_out: list[dict] = []
    for post in (
        db.query(models.Post)
        .options(joinedload(models.Post.tags), joinedload(models.Post.comments))
        .order_by(models.Post.slug)
        .all()
    ):
        comments = sorted(post.comments, key=lambda c: (c.created_at or datetime.min, c.id))
        ordinal_by_id = {c.id: i for i, c in enumerate(comments)}
        posts_out.append(
            {
                "slug": post.slug,
                "title": post.title,
                "content": post.content,
                "excerpt": post.excerpt,
                "published": bool(post.published),
                "pinned": bool(post.pinned),
                "publish_at": _iso(post.publish_at),
                "created_at": _iso(post.created_at),
                "updated_at": _iso(post.updated_at),
                "cover_image": post.cover_image,
                "views": post.views or 0,
                "likes": post.likes or 0,
                "category": post.category.name if post.category else None,
                "tags": [t.name for t in sorted(post.tags, key=lambda t: t.name)],
                "series": post.series.slug if post.series else None,
                "series_order": post.series_order,
                "comments": [
                    {
                        "import_key": f"{post.slug}#{i}",
                        "nickname": c.nickname,
                        "email": c.email,
                        "content": c.content,
                        "ip_address": c.ip_address,
                        "is_approved": bool(c.is_approved),
                        "reviewed_at": _iso(c.reviewed_at),
                        "created_at": _iso(c.created_at),
                        "parent_ordinal": (ordinal_by_id.get(c.parent_id) if c.parent_id is not None else None),
                        "reader": c.reader_id is not None,
                    }
                    for i, c in enumerate(comments)
                ],
            }
        )
    return {
        "format": "x-blog-backup",
        "version": 1,
        "exported_at": datetime.now(UTC).isoformat(),
        "categories": categories,
        "tags": tags,
        "series": series,
        "posts": posts_out,
    }


def restore_backup(db: Session, payload: dict) -> dict:
    """Import an ``x-blog-backup`` snapshot via natural-key upserts (DEC-082).

    Categories/tags by name, series by slug, posts by slug (existing post:
    content fields are updated, comment threads merged under ``import_key``;
    unknown slug: created). Post tags are rebuilt to match the snapshot.
    Comments upsert on (post_id, import_key) so a second import of the same
    snapshot never duplicates them; parents are re-wired after pass 1 (children
    may precede their parent in the export). Reader-attributed comments restore
    as anonymous (reader accounts don't round-trip).

    Raises ``ValueError`` for an unrecognized format so the route can 422.
    """
    if payload.get("format") != "x-blog-backup" or payload.get("version") != 1:
        raise ValueError("Unsupported backup format (expected x-blog-backup v1)")
    counts = {
        "categories": 0,
        "tags": 0,
        "series": 0,
        "posts_created": 0,
        "posts_updated": 0,
        "comments_created": 0,
        "comments_skipped": 0,
    }

    # Categories, tags, series — upsert by natural key, then flush so ids exist
    # for the post FK/relationship assignments below.
    cat_by_name = {c.name: c for c in db.query(models.Category).all()}
    for item in payload.get("categories", []):
        name = (item.get("name") or "").strip()
        if not name or name in cat_by_name:
            continue
        cat_by_name[name] = models.Category(name=name)
        db.add(cat_by_name[name])
        counts["categories"] += 1

    tag_by_name = {t.name: t for t in db.query(models.Tag).all()}
    for item in payload.get("tags", []):
        name = (item.get("name") or "").strip()
        if not name or name in tag_by_name:
            continue
        tag_by_name[name] = models.Tag(name=name)
        db.add(tag_by_name[name])
        counts["tags"] += 1

    series_by_slug = {s.slug: s for s in db.query(models.Series).all()}
    for item in payload.get("series", []):
        slug = (item.get("slug") or "").strip()
        if not slug:
            continue
        series = series_by_slug.get(slug)
        if series is None:
            series = models.Series(slug=slug)
            db.add(series)
            series_by_slug[slug] = series
            counts["series"] += 1
        series.title = item.get("title") or series.title
        series.description = item.get("description")

    db.flush()

    # Posts — upsert by slug; tags rebuilt; comments merged by import_key.
    post_by_slug = {p.slug: p for p in db.query(models.Post).all()}
    for item in payload.get("posts", []):
        slug = (item.get("slug") or "").strip()
        if not slug:
            continue
        post = post_by_slug.get(slug)
        if post is None:
            post = models.Post(slug=slug)
            db.add(post)
            post_by_slug[slug] = post
            counts["posts_created"] += 1
        else:
            counts["posts_updated"] += 1
        post.title = (item.get("title") or "Untitled")[:200]
        post.content = item.get("content") or ""
        post.excerpt = item.get("excerpt")
        post.published = bool(item.get("published", True))
        post.pinned = bool(item.get("pinned", False))
        post.publish_at = _from_iso(item.get("publish_at"))
        restored_created = _from_iso(item.get("created_at"))
        if restored_created is not None:
            post.created_at = restored_created
        post.cover_image = item.get("cover_image")
        post.views = int(item.get("views") or 0)
        post.likes = int(item.get("likes") or 0)
        category_name = item.get("category")
        post.category = cat_by_name.get(category_name) if category_name else None
        post.series = series_by_slug.get(item.get("series")) if item.get("series") else None
        post.series_order = int(item.get("series_order") or 0)
        post.tags = [tag_by_name[t] for t in (item.get("tags") or []) if t in tag_by_name]
        db.flush()  # post.id (and ids it links) must exist for the comment pass

        new_by_ordinal: dict[int, models.Comment] = {}
        metas = item.get("comments") or []
        for ordinal, cmeta in enumerate(metas):
            key = cmeta.get("import_key")
            if key is not None:
                existing = (
                    db.query(models.Comment)
                    .filter(models.Comment.import_key == key, models.Comment.post_id == post.id)
                    .first()
                )
                if existing is not None:
                    new_by_ordinal[ordinal] = existing
                    counts["comments_skipped"] += 1
                    continue
            comment = models.Comment(
                post_id=post.id,
                nickname=(cmeta.get("nickname") or "")[:50],
                email=cmeta.get("email"),
                content=cmeta.get("content") or "",
                ip_address=cmeta.get("ip_address"),
                is_approved=bool(cmeta.get("is_approved", True)),
                reviewed_at=_from_iso(cmeta.get("reviewed_at")),
                created_at=_from_iso(cmeta.get("created_at")),
                # Reader accounts don't round-trip (DEC-082): a reader-attributed
                # comment restores as anonymous free-text.
                import_key=key,
            )
            db.add(comment)
            new_by_ordinal[ordinal] = comment
            counts["comments_created"] += 1
        db.flush()  # comment ids for parent re-wiring
        for ordinal, cmeta in enumerate(metas):
            parent_ordinal = cmeta.get("parent_ordinal")
            if parent_ordinal is not None and parent_ordinal in new_by_ordinal:
                new_by_ordinal[ordinal].parent_id = new_by_ordinal[parent_ordinal].id

    return counts


def get_daily_views_stats(db: Session, days: int = 30) -> dict:
    """Reading-trend series + in-period top posts for the admin dashboard (DEC-086).

    ``series`` is every calendar day in [today-days+1, today] with its total
    views (zero-filled so the chart is a continuous axis). ``top_posts`` is the
    top 5 posts by in-period views (title/slug for deep links). The table only
    tracks forward from when the feature shipped — no backfill of the historic
    counter (honest, documented).
    """
    today = utc_now_naive().date()
    first = today - timedelta(days=days - 1)

    rows = (
        db.query(models.PostViewsDaily.day, func.sum(models.PostViewsDaily.views))
        .filter(models.PostViewsDaily.day >= first)
        .group_by(models.PostViewsDaily.day)
        .all()
    )
    by_day = {day: int(total) for day, total in rows}
    day = first
    series = []
    while day <= today:
        series.append({"day": day.isoformat(), "views": by_day.get(day, 0)})
        day += timedelta(days=1)

    top = (
        db.query(
            models.Post.id,
            models.Post.title,
            models.Post.slug,
            func.coalesce(func.sum(models.PostViewsDaily.views), 0).label("views"),
        )
        .join(models.PostViewsDaily, models.PostViewsDaily.post_id == models.Post.id)
        .filter(models.PostViewsDaily.day >= first)
        .group_by(models.Post.id, models.Post.title, models.Post.slug)
        .order_by(func.sum(models.PostViewsDaily.views).desc())
        .limit(5)
        .all()
    )

    return {
        "days": days,
        "total": sum(by_day.values()),
        "series": series,
        "top_posts": [{"id": row[0], "title": row[1], "slug": row[2], "views": int(row[3])} for row in top],
    }


def get_comment_activity_stats(db: Session, days: int = 30) -> dict:
    """Comment-activity series + in-period top posts for the admin dashboard (DEC-154/TASK-189).

    The engagement axis (distinct from views/searches/follows): per-day counts of
    approved, publicly visible comments plus the posts that draw the most
    discussion in the period. ``series`` is a zero-filled calendar-axis.
    """
    today = utc_now_naive().date()
    first = today - timedelta(days=days - 1)
    first_iso = first.isoformat()
    today_iso = today.isoformat()

    rows = (
        db.query(func.date(models.Comment.created_at).label("day"), func.count(models.Comment.id))
        .filter(
            models.Comment.is_approved.is_(True),
            func.date(models.Comment.created_at) >= first_iso,
            func.date(models.Comment.created_at) <= today_iso,
        )
        .group_by(func.date(models.Comment.created_at))
        .all()
    )
    by_day = {str(day): int(count) for day, count in rows}
    day = first
    series = []
    while day <= today:
        series.append({"day": day.isoformat(), "count": by_day.get(day.isoformat(), 0)})
        day += timedelta(days=1)

    top = (
        db.query(models.Post.id, models.Post.title, models.Post.slug, func.count(models.Comment.id))
        .join(models.Comment, models.Comment.post_id == models.Post.id)
        .filter(
            models.Comment.is_approved.is_(True),
            func.date(models.Comment.created_at) >= first_iso,
            func.date(models.Comment.created_at) <= today_iso,
        )
        .group_by(models.Post.id, models.Post.title, models.Post.slug)
        .order_by(func.count(models.Comment.id).desc())
        .limit(5)
        .all()
    )

    return {
        "days": days,
        "total": sum(by_day.values()),
        "series": series,
        "top_posts": [{"id": pid, "title": title, "slug": slug, "count": int(c)} for pid, title, slug, c in top],
    }
