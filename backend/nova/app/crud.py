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
        dispatch_new_post(db, db_post, logger)
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


def record_reading_history(db: Session, reader_id: int, post_id: int) -> tuple[models.ReadingHistory, bool]:
    """Upsert a view into the reader's history; returns (row, created).

    Idempotent: recording the same post again refreshes ``viewed_at`` in place
    (moving it to the front of the newest-first list) instead of duplicating —
    a reader revisiting a post bumps it, mirroring read-trail semantics
    (DEC-116, TASK-170).
    """
    existing = get_reading_history(db, reader_id, post_id)
    if existing:
        existing.viewed_at = datetime.now(UTC)
        db.add(existing)
        db.commit()
        db.refresh(existing)
        return existing, False
    row = models.ReadingHistory(reader_id=reader_id, post_id=post_id, viewed_at=datetime.now(UTC))
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, True


def list_reader_history(
    db: Session, reader_id: int, page: int = 1, limit: int = 20
) -> tuple[list[tuple[models.Post, datetime]], int]:
    """Return the reader's viewed posts (publicly visible only) newest-first.

    Paginated. Same non-leak invariant as bookmarks/subscriptions: a viewed post
    that was later un-published/scheduled simply stops appearing (the history row
    is kept; it reappears if the post becomes public again). Each item carries
    the post plus the last ``viewed_at`` so the UI can render when it was read.
    A reader's history is a bounded personal list, so the public-visibility
    filter runs in Python (mirroring list_reader_bookmarks) and pagination
    slices the filtered result — keeping ``total`` equal to the visible count.
    """
    rows = (
        db.query(models.Post, models.ReadingHistory.viewed_at)
        .join(models.ReadingHistory, models.ReadingHistory.post_id == models.Post.id)
        .filter(models.ReadingHistory.reader_id == reader_id)
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .order_by(models.ReadingHistory.viewed_at.desc(), models.Post.id.desc())
        .all()
    )
    visible = [(post, viewed_at) for post, viewed_at in rows if is_publicly_visible(post)]
    total = len(visible)
    page_items = visible[(page - 1) * limit : page * limit]
    return page_items, total


def clear_reader_history(db: Session, reader_id: int) -> int:
    """Delete every history row for a reader; returns the number removed."""
    deleted = db.query(models.ReadingHistory).filter(models.ReadingHistory.reader_id == reader_id).delete()
    db.commit()
    return deleted


def reader_history_stats(db: Session, reader_id: int, recent_limit: int = 6) -> dict:
    """Aggregate a reader's reading summary from their history (DEC-118).

    Returns total visible posts read, the sum of their reading minutes, the
    most-recent viewed timestamp, and the ``recent_limit`` most recent
    (post, viewed_at) pairs. Uses the same public-visibility filter as the
    history list so un-published posts don't leak or count.
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
    return {
        "total_posts": len(visible),
        "total_reading_minutes": total_minutes,
        "last_viewed_at": visible[0][1] if visible else None,
        "recent": visible[:recent_limit],
    }


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
    db.delete(reader)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ValueError("Cannot delete account: it has dependent records")
    return True


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
