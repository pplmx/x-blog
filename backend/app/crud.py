from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, joinedload

from app import models, schemas
from app.cache import categories_cache, clear_categories_cache, clear_posts_cache, clear_tags_cache, tags_cache


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
        query = query.filter(models.Post.published)

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
        category_id=post.category_id,
    )
    db_post.tags = tags
    db.add(db_post)
    try:
        db.commit()
        db.refresh(db_post)
    except Exception:
        db.rollback()
        raise

    # Clear cache
    clear_posts_cache()
    clear_tags_cache()

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

    if "tags" in update_data:
        tags = []
        for tag_name in update_data.pop("tags"):
            tag = db.query(models.Tag).filter(models.Tag.name == tag_name).first()
            if not tag:
                tag = models.Tag(name=tag_name)
                db.add(tag)
                db.flush()
            tags.append(tag)
        db_post.tags = tags

    for field, value in update_data.items():
        setattr(db_post, field, value)

    try:
        db.commit()
        db.refresh(db_post)
    except Exception:
        db.rollback()
        raise

    # Clear cache
    clear_posts_cache()
    clear_tags_cache()

    return db_post


def delete_post(db: Session, post_id: int) -> bool:
    db_post = db.get(models.Post, post_id)
    if not db_post:
        return False
    db.delete(db_post)
    db.commit()

    # Clear cache
    clear_posts_cache()

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


def create_category(db: Session, category: schemas.CategoryCreate) -> models.Category:
    db_category = models.Category(name=category.name)
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    # Clear cache
    clear_categories_cache()
    return db_category


def update_category(db: Session, category_id: int, category: schemas.CategoryCreate) -> models.Category | None:
    db_category = get_category(db, category_id)
    if not db_category:
        return None
    db_category.name = category.name
    db.commit()
    db.refresh(db_category)
    # Clear cache
    clear_categories_cache()
    return db_category


def delete_category(db: Session, category_id: int) -> bool:
    db_category = get_category(db, category_id)
    if not db_category:
        return False
    db.delete(db_category)
    db.commit()
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


def get_tag(db: Session, tag_id: int) -> models.Tag:
    return db.query(models.Tag).filter(models.Tag.id == tag_id).first()


def get_tag_by_name(db: Session, name: str) -> models.Tag:
    return db.query(models.Tag).filter(models.Tag.name == name).first()


def create_tag(db: Session, tag: schemas.TagCreate) -> models.Tag:
    db_tag = models.Tag(name=tag.name)
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    # Clear cache
    clear_tags_cache()
    return db_tag


def update_tag(db: Session, tag_id: int, tag: schemas.TagCreate) -> models.Tag:
    db_tag = get_tag(db, tag_id)
    if db_tag:
        db_tag.name = tag.name
        db.commit()
        db.refresh(db_tag)
        # Clear cache
        clear_tags_cache()
    return db_tag


def delete_tag(db: Session, tag_id: int) -> bool:
    db_tag = get_tag(db, tag_id)
    if db_tag:
        db.delete(db_tag)
        db.commit()
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
    db_comment = models.Comment(
        post_id=post_id,
        parent_id=comment.parent_id,
        nickname=comment.nickname,
        email=comment.email,
        content=comment.content,
        ip_address=ip_address,
        is_approved=comment.is_approved,
    )
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
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
    db.commit()
    return True


def search_posts(db: Session, query: str, page: int = 1, limit: int = 10):
    offset = (page - 1) * limit

    search_pattern = f"%{query}%"

    stmt = (
        select(models.Post)
        .where(
            or_(
                models.Post.title.ilike(search_pattern),
                models.Post.content.ilike(search_pattern),
            )
        )
        .where(models.Post.published)
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
        )
        .order_by(models.Post.title.ilike(search_pattern).desc(), models.Post.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    posts = db.execute(stmt).unique().scalars().all()

    count_stmt = (
        select(func.count(models.Post.id))
        .where(
            or_(
                models.Post.title.ilike(search_pattern),
                models.Post.content.ilike(search_pattern),
            )
        )
        .where(models.Post.published)
    )
    total = db.execute(count_stmt).scalar()

    return posts, total


def increment_views(db: Session, post_id: int) -> models.Post | None:
    """Increment the view count for a post using atomic SQL update."""
    stmt = (
        update(models.Post)
        .where(models.Post.id == post_id)
        .values(views=models.Post.views + 1)
    )
    result = db.execute(stmt)
    db.commit()
    if result.rowcount == 0:
        return None
    return db.get(models.Post, post_id)


def increment_likes(db: Session, post_id: int) -> models.Post | None:
    """Increment the like count for a post using atomic SQL update."""
    stmt = (
        update(models.Post)
        .where(models.Post.id == post_id)
        .values(likes=models.Post.likes + 1)
    )
    result = db.execute(stmt)
    db.commit()
    if result.rowcount == 0:
        return None
    return db.get(models.Post, post_id)


def get_popular_posts(db: Session, limit: int = 5) -> list[models.Post]:
    """Get the most popular posts by view count."""
    return (
        db.query(models.Post)
        .filter(models.Post.published)
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
        )
        .order_by(models.Post.views.desc())
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
        query = db.query(models.Post).filter(
            models.Post.published,
            models.Post.id != post_id,
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
    query = (
        db.query(models.Post, tag_match_count_subq.c.match_count)
        .outerjoin(tag_match_count_subq, models.Post.id == tag_match_count_subq.c.post_id)
        .filter(
            models.Post.published,
            models.Post.id != post_id,
        )
        .options(
            joinedload(models.Post.category),
            joinedload(models.Post.tags),
        )
    )

    # Same category gets higher priority (add 100 to match_count)
    if post.category_id:
        query = query.add_columns(
            case(
                (models.Post.category_id == post.category_id, tag_match_count_subq.c.match_count + 100),
                else_=tag_match_count_subq.c.match_count,
            ).label("priority")
        )
        query = query.order_by(
            case(
                (models.Post.category_id == post.category_id, tag_match_count_subq.c.match_count + 100),
                else_=tag_match_count_subq.c.match_count,
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
