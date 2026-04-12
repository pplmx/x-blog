from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, ConfigDict
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app import auth, crud, models
from app.auth import get_current_admin
from app.database import get_db
from app.schemas import PostCreate, PostUpdate

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/admin", tags=["admin"])


class LoginResponse(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    is_superuser: bool


@router.post("/login", response_model=LoginResponse)
@limiter.limit("60/minute")
def login(
    request: Request,  # noqa: ARG001
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = db.query(auth.User).filter(auth.User.username == form_data.username).first()
    if not user or not auth.verify_password(form_data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = auth.create_access_token(data={"sub": user.id})
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/users", response_model=UserResponse)
def create_user(
    user_data: UserCreate,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    existing = db.query(auth.User).filter(auth.User.username == user_data.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    hashed_password = auth.get_password_hash(user_data.password)
    user = auth.User(
        username=user_data.username,
        password=hashed_password,
        is_superuser=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/users", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    users = db.query(auth.User).all()
    return users


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    if user_id == _current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = db.query(auth.User).filter(auth.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)
    db.commit()
    return {"message": "User deleted"}


@router.get("/posts", response_model=list[dict])
def admin_list_posts(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
    skip: int = 0,
    limit: int = 20,
):
    posts = db.query(models.Post).offset(skip).limit(limit).all()
    return [
        {
            "id": p.id,
            "title": p.title,
            "slug": p.slug,
            "published": p.published,
            "category": p.category.name if p.category else None,
            "tags": [t.name for t in p.tags],
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        }
        for p in posts
    ]


@router.get("/posts/{post_id}", response_model=dict)
def admin_get_post(
    post_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return {
        "id": post.id,
        "title": post.title,
        "slug": post.slug,
        "content": post.content,
        "excerpt": post.excerpt,
        "published": post.published,
        "category_id": post.category_id,
        "tag_ids": [t.id for t in post.tags],
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "updated_at": post.updated_at.isoformat() if post.updated_at else None,
    }


@router.post("/posts", response_model=dict)
def admin_create_post(
    post_data: PostCreate,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = crud.create_post(db, post_data)
    return {"id": post.id}


@router.put("/posts/{post_id}", response_model=dict)
def admin_update_post(
    post_id: int,
    post_data: PostUpdate,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    if post_data.title is not None:
        post.title = post_data.title
    if post_data.slug is not None:
        post.slug = post_data.slug
    if post_data.content is not None:
        post.content = post_data.content
    if post_data.excerpt is not None:
        post.excerpt = post_data.excerpt
    if post_data.published is not None:
        post.published = post_data.published
    post.category_id = post_data.category_id

    if post_data.tag_ids is not None:
        tags = db.query(models.Tag).filter(models.Tag.id.in_(post_data.tag_ids)).all()
        post.tags = tags

    db.commit()
    db.refresh(post)
    return {"id": post.id}


@router.delete("/posts/{post_id}")
def admin_delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    db.delete(post)
    db.commit()
    return {"message": "Post deleted"}


@router.get("/categories", response_model=list[dict])
def admin_list_categories(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    categories = db.query(models.Category).all()
    return [{"id": c.id, "name": c.name} for c in categories]


@router.post("/categories", response_model=dict)
def admin_create_category(
    name: str,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    existing = db.query(models.Category).filter(models.Category.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")

    category = models.Category(name=name)
    db.add(category)
    db.commit()
    db.refresh(category)
    return {"id": category.id, "name": category.name}


@router.put("/categories/{category_id}", response_model=dict)
def admin_update_category(
    category_id: int,
    name: str,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    category.name = name
    db.commit()
    return {"id": category.id, "name": category.name}


@router.delete("/categories/{category_id}")
def admin_delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    db.delete(category)
    db.commit()
    return {"message": "Category deleted"}


@router.get("/tags", response_model=list[dict])
def admin_list_tags(
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tags = db.query(models.Tag).all()
    return [{"id": t.id, "name": t.name} for t in tags]


@router.post("/tags", response_model=dict)
def admin_create_tag(
    name: str,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    existing = db.query(models.Tag).filter(models.Tag.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Tag already exists")

    tag = models.Tag(name=name)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return {"id": tag.id, "name": tag.name}


@router.put("/tags/{tag_id}", response_model=dict)
def admin_update_tag(
    tag_id: int,
    name: str,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    tag.name = name
    db.commit()
    return {"id": tag.id, "name": tag.name}


@router.delete("/tags/{tag_id}")
def admin_delete_tag(
    tag_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    tag = db.query(models.Tag).filter(models.Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    db.delete(tag)
    db.commit()
    return {"message": "Tag deleted"}


# Comments management
@router.get("/comments", response_model=list[dict])
def admin_list_comments(
    post_id: int | None = None,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    query = db.query(models.Comment).order_by(models.Comment.created_at.desc())
    if post_id:
        query = query.filter(models.Comment.post_id == post_id)
    comments = query.all()
    result = []
    for c in comments:
        post = db.query(models.Post).filter(models.Post.id == c.post_id).first()
        result.append(
            {
                "id": c.id,
                "post_id": c.post_id,
                "post_title": post.title if post else "Unknown",
                "nickname": c.nickname,
                "email": c.email,
                "content": c.content,
                "ip_address": c.ip_address,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
        )
    return result


@router.delete("/comments/{comment_id}")
def admin_delete_comment(
    comment_id: int,
    db: Session = Depends(get_db),
    _current_user: auth.User = Depends(get_current_admin),
):
    comment = db.query(models.Comment).filter(models.Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    db.delete(comment)
    db.commit()
    return {"message": "Comment deleted"}
