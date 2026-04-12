from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import models, schemas


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

    total = query.count()
    posts = query.offset(skip).limit(limit).all()
    return posts, total


def get_post(db: Session, post_id: int) -> models.Post | None:
    return db.query(models.Post).filter(models.Post.id == post_id).first()


def get_post_by_slug(db: Session, slug: str) -> models.Post | None:
    return db.query(models.Post).filter(models.Post.slug == slug).first()


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
    return db_post


def delete_post(db: Session, post_id: int) -> bool:
    db_post = get_post(db, post_id)
    if not db_post:
        return False
    db.delete(db_post)
    db.commit()
    return True


def get_categories(db: Session) -> list[models.Category]:
    return db.query(models.Category).all()


def get_category(db: Session, category_id: int) -> models.Category | None:
    return db.query(models.Category).filter(models.Category.id == category_id).first()


def create_category(db: Session, category: schemas.CategoryCreate) -> models.Category:
    db_category = models.Category(name=category.name)
    db.add(db_category)
    db.commit()
    db.refresh(db_category)
    return db_category


def update_category(db: Session, category_id: int, category: schemas.CategoryCreate) -> models.Category | None:
    db_category = get_category(db, category_id)
    if not db_category:
        return None
    db_category.name = category.name
    db.commit()
    db.refresh(db_category)
    return db_category


def delete_category(db: Session, category_id: int) -> bool:
    db_category = get_category(db, category_id)
    if not db_category:
        return False
    db.delete(db_category)
    db.commit()
    return True


def get_tags(db: Session) -> list[models.Tag]:
    return db.query(models.Tag).all()


def get_tag(db: Session, tag_id: int) -> models.Tag:
    return db.query(models.Tag).filter(models.Tag.id == tag_id).first()


def get_tag_by_name(db: Session, name: str) -> models.Tag:
    return db.query(models.Tag).filter(models.Tag.name == name).first()


def create_tag(db: Session, tag: schemas.TagCreate) -> models.Tag:
    db_tag = models.Tag(name=tag.name)
    db.add(db_tag)
    db.commit()
    db.refresh(db_tag)
    return db_tag


def update_tag(db: Session, tag_id: int, tag: schemas.TagCreate) -> models.Tag:
    db_tag = get_tag(db, tag_id)
    if db_tag:
        db_tag.name = tag.name
        db.commit()
        db.refresh(db_tag)
    return db_tag


def delete_tag(db: Session, tag_id: int) -> bool:
    db_tag = get_tag(db, tag_id)
    if db_tag:
        db.delete(db_tag)
        db.commit()
        return True
    return False


def get_comments(db: Session, post_id: int) -> list[models.Comment]:
    return (
        db.query(models.Comment)
        .filter(models.Comment.post_id == post_id)
        .order_by(models.Comment.created_at.desc())
        .all()
    )


def create_comment(
    db: Session,
    post_id: int,
    comment: schemas.CommentCreate,
    ip_address: str,
) -> models.Comment:
    db_comment = models.Comment(
        post_id=post_id,
        nickname=comment.nickname,
        email=comment.email,
        content=comment.content,
        ip_address=ip_address,
    )
    db.add(db_comment)
    db.commit()
    db.refresh(db_comment)
    return db_comment


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
        .order_by(models.Post.title.ilike(search_pattern).desc(), models.Post.created_at.desc())
        .offset(offset)
        .limit(limit)
    )

    posts = db.execute(stmt).scalars().all()

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
    """Increment the view count for a post."""
    post = get_post(db, post_id)
    if not post:
        return None
    post.views = (post.views or 0) + 1
    db.commit()
    db.refresh(post)
    return post


def get_popular_posts(db: Session, limit: int = 5) -> list[models.Post]:
    """Get the most popular posts by view count."""
    return (
        db.query(models.Post)
        .filter(models.Post.published)
        .order_by(models.Post.views.desc())
        .limit(limit)
        .all()
    )
