from datetime import UTC, datetime

from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.cache import (
    categories_cache,
    clear_categories_cache,
    clear_posts_list_cache,
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


def get_posts(
    db: Session,
    skip: int = 0,
    limit: int = 10,
    published: bool = True,
    category_id: int | None = None,
    tag_id: int | None = None,
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

    # Count before pagination
    total = query.count()

    # Eager load relationships to avoid N+1 queries
    query = query.options(
        joinedload(models.Post.category),
        joinedload(models.Post.tags),
    )

    # Sort by pinned first, then by created_at
    posts = query.order_by(models.Post.pinned.desc(), models.Post.created_at.desc()).offset(skip).limit(limit).all()
    return posts, total


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
    clear_posts_list_cache()
    return True


def get_categories(db: Session) -> list[models.Category]:
    # Check cache first
    cache_key = "all_categories"
    if cache_key in categories_cache:
        return categories_cache[cache_key]

    # Query database
    categories = db.query(models.Category).all()

    # Cache the result
    categories_cache[cache_key] = categories
    return categories


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


def get_tags(db: Session) -> list[models.Tag]:
    # Check cache first
    cache_key = "all_tags"
    if cache_key in tags_cache:
        return tags_cache[cache_key]

    # Query database
    tags = db.query(models.Tag).all()

    # Cache the result
    tags_cache[cache_key] = tags
    return tags


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

    db_comment = models.Comment(
        post_id=post_id,
        parent_id=comment.parent_id,
        nickname=comment.nickname,
        email=comment.email,
        content=comment.content,
        ip_address=ip_address,
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
    return db_comment


def approve_comment(db: Session, comment_id: int, approved: bool = True) -> models.Comment | None:
    """Approve or reject a comment."""
    comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
    if not comment:
        return None
    comment.is_approved = approved
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
    return (
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
        return (
            query.options(
                joinedload(models.Post.category),
                joinedload(models.Post.tags),
            )
            .order_by(models.Post.created_at.desc())
            .limit(limit)
            .all()
        )

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
    return [row[0] for row in results]
