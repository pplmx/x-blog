# Aurora 博客后端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 FastAPI 后端，提供博客文章 REST API

**Architecture:** FastAPI + SQLAlchemy + SQLite，异步 REST API

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic, SQLite

---

## 文件结构

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI 应用入口
│   ├── config.py        # 配置
│   ├── models.py        # SQLAlchemy 模型
│   ├── schemas.py       # Pydantic schemas
│   ├── crud.py          # 数据库操作
│   └── routers/
│       ├── __init__.py
│       └── posts.py     # 文章 API 路由
├── tests/
│   ├── __init__.py
│   └── test_posts.py    # 文章 API 测试
├── pyproject.toml       # 项目依赖
└── requirements.txt     # 依赖列表
```

---

### Task 1: 项目初始化

**Files:**

- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/main.py`

- [ ] **Step 1: 创建 pyproject.toml**

```toml
[project]
name = "aurora-backend"
version = "0.1.0"
description = "Aurora Blog Backend"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "sqlalchemy>=2.0.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",
    "pytest-asyncio>=0.23.0",
]
```

- [ ] **Step 2: 安装依赖**

```bash
cd backend
pip install -e ".[dev]"
```

- [ ] **Step 3: 创建 FastAPI 应用**

```python
# backend/app/main.py
from fastapi import FastAPI

app = FastAPI(title="Aurora Blog API", version="0.1.0")

@app.get("/")
def read_root():
    return {"message": "Aurora Blog API"}
```

- [ ] **Step 4: 验证服务运行**

```bash
cd backend
uvicorn app.main:app --reload --port 8000
# 访问 http://localhost:8000/ 应返回 {"message":"Aurora Blog API"}
```

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: init FastAPI backend project"
```

---

### Task 2: 数据库配置和模型

**Files:**

- Create: `backend/app/config.py`
- Create: `backend/app/models.py`
- Create: `backend/app/database.py`

- [ ] **Step 1: 创建配置**

```python
# backend/app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "sqlite:///./aurora.db"

    class Config:
        env_file = ".env"

settings = Settings()
```

- [ ] **Step 2: 创建数据库连接**

```python
# backend/app/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3: 创建数据模型**

```python
# backend/app/models.py
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base

post_tags = Table(
    "post_tags",
    Base.metadata,
    Column("post_id", Integer, ForeignKey("posts.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True)
)

class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    slug = Column(String(200), unique=True, index=True, nullable=False)
    content = Column(Text, nullable=False)
    excerpt = Column(String(500))
    published = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    category_id = Column(Integer, ForeignKey("categories.id"))

    category = relationship("Category", back_populates="posts")
    tags = relationship("Tag", secondary=post_tags, back_populates="posts")

class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)

    posts = relationship("Post", back_populates="category")

class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False)

    posts = relationship("Post", secondary=post_tags, back_populates="tags")
```

- [ ] **Step 4: 更新 main.py 添加数据库表创建**

```python
# backend/app/main.py
from fastapi import FastAPI
from app.database import engine, Base

app = FastAPI(title="Aurora Blog API", version="0.1.0")

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

@app.get("/")
def read_root():
    return {"message": "Aurora Blog API"}
```

- [ ] **Step 5: 测试运行**

```bash
cd backend
uvicorn app.main:app --reload --port 8000
# 检查是否正常启动，无错误
```

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat: add database config and models"
```

---

### Task 3: Pydantic Schemas

**Files:**

- Create: `backend/app/schemas.py`

- [ ] **Step 1: 创建 Pydantic schemas**

```python
# backend/app/schemas.py
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class TagBase(BaseModel):
    name: str

class TagCreate(TagBase):
    pass

class Tag(TagBase):
    id: int

    class Config:
        from_attributes = True

class CategoryBase(BaseModel):
    name: str

class CategoryCreate(CategoryBase):
    pass

class Category(CategoryBase):
    id: int

    class Config:
        from_attributes = True

class PostBase(BaseModel):
    title: str
    slug: str
    content: str
    excerpt: Optional[str] = None
    published: bool = False
    category_id: Optional[int] = None

class PostCreate(PostBase):
    tags: List[str] = []

class PostUpdate(BaseModel):
    title: Optional[str] = None
    slug: Optional[str] = None
    content: Optional[str] = None
    excerpt: Optional[str] = None
    published: Optional[bool] = None
    category_id: Optional[int] = None
    tags: Optional[List[str]] = None

class Post(PostBase):
    id: int
    created_at: datetime
    updated_at: datetime
    category: Optional[Category] = None
    tags: List[Tag] = []

    class Config:
        from_attributes = True

class PostList(BaseModel):
    id: int
    title: str
    slug: str
    excerpt: Optional[str]
    published: bool
    created_at: datetime
    category: Optional[Category] = None
    tags: List[Tag] = []

    class Config:
        from_attributes = True
```

- [ ] **Step 2: Commit**

```bash
git add backend/
git commit -m "feat: add pydantic schemas"
```

---

### Task 4: CRUD 操作

**Files:**

- Create: `backend/app/crud.py`

- [ ] **Step 1: 创建 CRUD 操作**

```python
# backend/app/crud.py
from sqlalchemy.orm import Session
from app import models, schemas
from typing import List, Optional

def get_posts(db: Session, skip: int = 0, limit: int = 10, published: bool = True) -> List[models.Post]:
    query = db.query(models.Post)
    if published:
        query = query.filter(models.Post.published == True)
    return query.offset(skip).limit(limit).all()

def get_post(db: Session, post_id: int) -> Optional[models.Post]:
    return db.query(models.Post).filter(models.Post.id == post_id).first()

def get_post_by_slug(db: Session, slug: str) -> Optional[models.Post]:
    return db.query(models.Post).filter(models.Post.slug == slug).first()

def create_post(db: Session, post: schemas.PostCreate) -> models.Post:
    # 处理分类
    category = None
    if post.category_id:
        category = db.query(models.Category).filter(models.Category.id == post.category_id).first()

    # 处理标签
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
    db.commit()
    db.refresh(db_post)
    return db_post

def update_post(db: Session, post_id: int, post: schemas.PostUpdate) -> Optional[models.Post]:
    db_post = get_post(db, post_id)
    if not db_post:
        return None

    update_data = post.model_dump(exclude_unset=True)

    # 处理标签更新
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

    db.commit()
    db.refresh(db_post)
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/
git commit -m "feat: add CRUD operations"
```

---

### Task 5: API 路由

**Files:**

- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/routers/posts.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 创建路由初始化**

```python
# backend/app/routers/__init__.py
```

- [ ] **Step 2: 创建文章路由**

```python
# backend/app/routers/posts.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/api/posts", tags=["posts"])

@router.get("", response_model=List[schemas.PostList])
def list_posts(skip: int = 0, limit: int = 10, db: Session = Depends(get_db)):
    posts = crud.get_posts(db, skip=skip, limit=limit)
    return posts

@router.get("/{post_id}", response_model=schemas.Post)
def get_post(post_id: int, db: Session = Depends(get_db)):
    post = crud.get_post(db, post_id)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post

@router.post("", response_model=schemas.Post, status_code=status.HTTP_201_CREATED)
def create_post(post: schemas.PostCreate, db: Session = Depends(get_db)):
    existing = crud.get_post_by_slug(db, post.slug)
    if existing:
        raise HTTPException(status_code=400, detail="Slug already exists")
    return crud.create_post(db, post)

@router.put("/{post_id}", response_model=schemas.Post)
def update_post(post_id: int, post: schemas.PostUpdate, db: Session = Depends(get_db)):
    db_post = crud.update_post(db, post_id, post)
    if not db_post:
        raise HTTPException(status_code=404, detail="Post not found")
    return db_post

@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(post_id: int, db: Session = Depends(get_db)):
    success = crud.delete_post(db, post_id)
    if not success:
        raise HTTPException(status_code=404, detail="Post not found")
```

- [ ] **Step 3: 更新 main.py 注册路由**

```python
# backend/app/main.py
from fastapi import FastAPI
from app.database import engine, Base
from app.routers import posts

app = FastAPI(title="Aurora Blog API", version="0.1.0")

app.include_router(posts.router)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

@app.get("/")
def read_root():
    return {"message": "Aurora Blog API"}
```

- [ ] **Step 4: 测试 API**

```bash
cd backend
uvicorn app.main:app --reload --port 8000

# 测试端点
curl http://localhost:8000/api/posts
# 应返回 []

curl -X POST http://localhost:8000/api/posts \
  -H "Content-Type: application/json" \
  -d '{"title":"Hello","slug":"hello","content":"World","published":true}'
# 应返回创建的文章
```

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: add posts API routes"
```

---

### Task 6: 分类和标签路由

**Files:**

- Create: `backend/app/routers/categories.py`
- Create: `backend/app/routers/tags.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 创建分类路由**

```python
# backend/app/routers/categories.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/api/categories", tags=["categories"])

@router.get("", response_model=List[schemas.Category])
def list_categories(db: Session = Depends(get_db)):
    return crud.get_categories(db)
```

- [ ] **Step 2: 创建标签路由**

```python
# backend/app/routers/tags.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/api/tags", tags=["tags"])

@router.get("", response_model=List[schemas.Tag])
def list_tags(db: Session = Depends(get_db)):
    return crud.get_tags(db)
```

- [ ] **Step 3: 更新 main.py**

```python
# backend/app/main.py
from fastapi import FastAPI
from app.database import engine, Base
from app.routers import posts, categories, tags

app = FastAPI(title="Aurora Blog API", version="0.1.0")

app.include_router(posts.router)
app.include_router(categories.router)
app.include_router(tags.router)

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)

@app.get("/")
def read_root():
    return {"message": "Aurora Blog API"}
```

- [ ] **Step 4: 测试路由**

```bash
curl http://localhost:8000/api/categories
curl http://localhost:8000/api/tags
```

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat: add categories and tags API routes"
```

---

### Task 7: 单元测试

**Files:**

- Create: `backend/tests/__init__.py`
- Create: `backend/tests/test_posts.py`

- [ ] **Step 1: 创建测试初始化**

```python
# backend/tests/__init__.py
```

- [ ] **Step 2: 写测试**

```python
# backend/tests/test_posts.py
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="function")
def client():
    Base.metadata.create_all(bind=engine)
    yield TestClient(app)
    Base.metadata.drop_all(bind=engine)

def test_create_post(client):
    response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Post"
    assert data["slug"] == "test-post"

def test_list_posts(client):
    # 先创建一篇文章
    client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True
        }
    )

    response = client.get("/api/posts")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1

def test_get_post(client):
    # 先创建
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True
        }
    )
    post_id = create_response.json()["id"]

    response = client.get(f"/api/posts/{post_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Test Post"

def test_update_post(client):
    # 先创建
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True
        }
    )
    post_id = create_response.json()["id"]

    response = client.put(
        f"/api/posts/{post_id}",
        json={"title": "Updated Title"}
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Updated Title"

def test_delete_post(client):
    # 先创建
    create_response = client.post(
        "/api/posts",
        json={
            "title": "Test Post",
            "slug": "test-post",
            "content": "Test content",
            "published": True
        }
    )
    post_id = create_response.json()["id"]

    response = client.delete(f"/api/posts/{post_id}")
    assert response.status_code == 204

    # 验证删除
    get_response = client.get(f"/api/posts/{post_id}")
    assert get_response.status_code == 404
```

- [ ] **Step 3: 运行测试**

```bash
cd backend
pytest tests/ -v
# 应全部通过
```

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "test: add posts API tests"
```

---

## 验证

完成所有任务后，验证：

1. API 端点正常工作
2. 测试全部通过
3. 代码能正常启动

```bash
cd backend
uvicorn app.main:app --reload --port 8000
# 测试 http://localhost:8000/docs 查看 Swagger 文档
```
