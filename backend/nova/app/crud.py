from datetime import UTC, datetime

from sqlalchemy import extract, func, or_, select, update
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
    return db_post


def update_post(db: Session, post_id: int, post: schemas.PostUpdate) -> models.Post | None:
    db_post = get_post(db, post_id)
    if not db_post:
        return None

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
) -> tuple[list[models.Comment], int]:
    """Get paginated approved comments for a post.

    Returns:
        Tuple of (comments list, total count)
    """
    query = db.query(models.Comment).filter(
        models.Comment.post_id == post_id,
        models.Comment.is_approved == True,  # noqa: E712
    )

    total = query.count()
    comments = query.order_by(models.Comment.created_at.desc()).offset((page - 1) * limit).limit(limit).all()

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
    db.commit()
    db.refresh(comment)
    # Approving (or rejecting) a comment changes the approved comment_count
    # surfaced on the cached public posts list (RIL TASK-073, ISS-041).
    clear_posts_list_cache()
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


def search_posts(db: Session, query: str, page: int = 1, limit: int = 10) -> tuple[list[models.Post], int]:
    offset = (page - 1) * limit
    is_postgres = db.get_bind().dialect.name == "postgresql"

    now = utc_now_naive()
    # Scheduled posts are not searchable before their publish_at (same rule as list)
    scheduled_filter = or_(models.Post.publish_at.is_(None), models.Post.publish_at <= now)

    if is_postgres:
        ts_query = func.plainto_tsquery("english", query)
        ts_vector = func.to_tsvector(
            "english",
            models.Post.title + " " + func.coalesce(models.Post.excerpt, "") + " " + models.Post.content,
        )

        stmt = (
            select(models.Post)
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .where(ts_vector.op("@@")(ts_query))
            .order_by(func.ts_rank(ts_vector, ts_query).desc())
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
            .where(ts_vector.op("@@")(ts_query))
        )
    else:
        search_pattern = f"%{escape_like_pattern(query)}%"

        stmt = (
            select(models.Post)
            .where(
                or_(
                    models.Post.title.ilike(search_pattern, escape="\\"),
                    models.Post.content.ilike(search_pattern, escape="\\"),
                )
            )
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
            .options(
                joinedload(models.Post.category),
                joinedload(models.Post.tags),
            )
            .order_by(models.Post.title.ilike(search_pattern, escape="\\").desc(), models.Post.created_at.desc())
            .offset(offset)
            .limit(limit)
        )

        count_stmt = (
            select(func.count(models.Post.id))
            .where(
                or_(
                    models.Post.title.ilike(search_pattern, escape="\\"),
                    models.Post.content.ilike(search_pattern, escape="\\"),
                )
            )
            .where(models.Post.published.is_(True))
            .where(scheduled_filter)
        )

    posts = list(db.execute(stmt).unique().scalars().all())
    total = db.execute(count_stmt).scalar()
    assert total is not None  # COUNT(*) always yields one row

    return posts, total


def increment_views(db: Session, post_id: int) -> models.Post | None:
    """Increment the view count for a post using atomic SQL update."""
    stmt = update(models.Post).where(models.Post.id == post_id).values(views=models.Post.views + 1)
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


def list_reader_bookmarks(db: Session, reader_id: int) -> list[models.Post]:
    """Return the reader's bookmarked posts that are *publicly visible* only.

    Post timestamps/visibility can change after a bookmark is saved; the list
    must not leak a draft or scheduled post on a read path (same invariant as
    the public post/comment read paths). Non-visible posts simply don't appear,
    newest bookmark first.
    """
    rows = (
        db.query(models.Post)
        .join(models.ReaderBookmark, models.ReaderBookmark.post_id == models.Post.id)
        .filter(models.ReaderBookmark.reader_id == reader_id)
        .options(joinedload(models.Post.category), joinedload(models.Post.tags))
        .order_by(models.ReaderBookmark.created_at.desc())
        .all()
    )
    return [p for p in rows if is_publicly_visible(p)]


def get_reader_comments(db: Session, reader_id: int) -> list[models.Comment]:
    """A reader's own approved comments, newest first (DEC-062, TASK-135).

    Only approved comments appear — pending/rejected comments are invisible to
    the author on this read path (they will surface once moderated), matching
    the public visibility rule.
    """
    return (
        db.query(models.Comment)
        .filter(
            models.Comment.reader_id == reader_id,
            models.Comment.is_approved == True,  # noqa: E712
        )
        .order_by(models.Comment.created_at.desc())
        .all()
    )
