from sqlalchemy.orm import Session
from app import models, schemas
from typing import List, Optional, Tuple


def get_posts(
    db: Session,
    skip: int = 0,
    limit: int = 10,
    published: bool = True,
    category_id: Optional[int] = None,
    tag_id: Optional[int] = None,
) -> Tuple[List[models.Post], int]:
    query = db.query(models.Post)

    if published:
        query = query.filter(models.Post.published == True)

    if category_id:
        query = query.filter(models.Post.category_id == category_id)

    if tag_id:
        query = query.join(models.Post.tags).filter(models.Tag.id == tag_id).distinct()

    total = query.count()
    posts = query.offset(skip).limit(limit).all()
    return posts, total


def get_post(db: Session, post_id: int) -> Optional[models.Post]:
    return db.query(models.Post).filter(models.Post.id == post_id).first()


def get_post_by_slug(db: Session, slug: str) -> Optional[models.Post]:
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


def update_post(db: Session, post_id: int, post: schemas.PostUpdate) -> Optional[models.Post]:
    db_post = get_post(db, post_id)
    if not db_post:
        return None

    update_data = post.model_dump(exclude_unset=True)

    if "category_id" in update_data and update_data["category_id"] is not None:
        category = (
            db.query(models.Category)
            .filter(models.Category.id == update_data["category_id"])
            .first()
        )
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


def get_categories(db: Session) -> List[models.Category]:
    return db.query(models.Category).all()


def get_tags(db: Session) -> List[models.Tag]:
    return db.query(models.Tag).all()
