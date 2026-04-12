# Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive tests for all core features

**Architecture:** 使用现有测试框架 (pytest + vitest)

**Tech Stack:** pytest, vitest, Testing Library

---

## 文件结构

```text
backend/tests/
├── test_posts.py       # 已有 (5 tests)
├── test_categories.py  # 新增
├── test_tags.py        # 新增
├── test_comments.py    # 新增
└── test_search.py      # 新增

frontend/components/
├── Pagination.test.tsx  # 已有 (7 tests)
├── PostCard.test.tsx    # 已有 (7 tests)
├── CommentList.test.tsx # 新增
├── CommentForm.test.tsx # 新增
└── SearchBox.test.tsx   # 新增
```

---

### Task 1: 后端 - Categories API 测试

**Files:**

- Create: `backend/tests/test_categories.py`

- [ ] **Step 1: 创建测试文件**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_categories.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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

def test_create_category(client):
    response = client.post("/api/categories", json={"name": "Tech"})
    assert response.status_code == 201
    assert response.json()["name"] == "Tech"

def test_list_categories(client):
    client.post("/api/categories", json={"name": "Tech"})
    response = client.get("/api/categories")
    assert response.status_code == 200
    assert len(response.json()) == 1

def test_get_category(client):
    create_resp = client.post("/api/categories", json={"name": "Tech"})
    cat_id = create_resp.json()["id"]
    response = client.get(f"/api/categories/{cat_id}")
    assert response.status_code == 200

def test_update_category(client):
    create_resp = client.post("/api/categories", json={"name": "Tech"})
    cat_id = create_resp.json()["id"]
    response = client.put(f"/api/categories/{cat_id}", json={"name": "Tech Updated"})
    assert response.status_code == 200
    assert response.json()["name"] == "Tech Updated"

def test_delete_category(client):
    create_resp = client.post("/api/categories", json={"name": "Tech"})
    cat_id = create_resp.json()["id"]
    response = client.delete(f"/api/categories/{cat_id}")
    assert response.status_code == 204
```

- [ ] **Step 2: 运行测试并提交**

```bash
cd backend && uv run pytest tests/test_categories.py -v
git add backend/tests/test_categories.py && git commit -m "test: add categories API tests"
```

---

### Task 2: 后端 - Tags API 测试

**Files:**

- Create: `backend/tests/test_tags.py`

- [ ] **Step 1: 创建测试文件**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_tags.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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

def test_create_tag(client):
    response = client.post("/api/tags", json={"name": "python"})
    assert response.status_code == 201
    assert response.json()["name"] == "python"

def test_list_tags(client):
    client.post("/api/tags", json={"name": "python"})
    response = client.get("/api/tags")
    assert response.status_code == 200
    assert len(response.json()) == 1

def test_get_tag(client):
    create_resp = client.post("/api/tags", json={"name": "python"})
    tag_id = create_resp.json()["id"]
    response = client.get(f"/api/tags/{tag_id}")
    assert response.status_code == 200

def test_update_tag(client):
    create_resp = client.post("/api/tags", json={"name": "python"})
    tag_id = create_resp.json()["id"]
    response = client.put(f"/api/tags/{tag_id}", json={"name": "javascript"})
    assert response.status_code == 200

def test_delete_tag(client):
    create_resp = client.post("/api/tags", json={"name": "python"})
    tag_id = create_resp.json()["id"]
    response = client.delete(f"/api/tags/{tag_id}")
    assert response.status_code == 204
```

- [ ] **Step 2: 运行测试并提交**

```bash
cd backend && uv run pytest tests/test_tags.py -v
git add backend/tests/test_tags.py && git commit -m "test: add tags API tests"
```

---

### Task 3: 后端 - Comments API 测试

**Files:**

- Create: `backend/tests/test_comments.py`

- [ ] **Step 1: 创建测试文件**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_comments.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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

@pytest.fixture
def post_id(client):
    response = client.post("/api/posts", json={
        "title": "Test Post",
        "slug": "test-post",
        "content": "Test content",
        "published": True
    })
    return response.json()["id"]

def test_create_comment(client, post_id):
    response = client.post("/api/comments", json={
        "post_id": post_id,
        "author": "John",
        "content": "Great post!"
    })
    assert response.status_code == 201
    assert response.json()["author"] == "John"

def test_list_comments(client, post_id):
    client.post("/api/comments", json={
        "post_id": post_id,
        "author": "John",
        "content": "Great post!"
    })
    response = client.get(f"/api/comments?post_id={post_id}")
    assert response.status_code == 200
    assert len(response.json()) == 1

def test_delete_comment(client, post_id):
    create_resp = client.post("/api/comments", json={
        "post_id": post_id,
        "author": "John",
        "content": "Great post!"
    })
    comment_id = create_resp.json()["id"]
    response = client.delete(f"/api/comments/{comment_id}")
    assert response.status_code == 204
```

- [ ] **Step 2: 运行测试并提交**

```bash
cd backend && uv run pytest tests/test_comments.py -v
git add backend/tests/test_comments.py && git commit -m "test: add comments API tests"
```

---

### Task 4: 后端 - Search API 测试

**Files:**

- Create: `backend/tests/test_search.py`

- [ ] **Step 1: 创建测试文件**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.main import app
from app.database import Base, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_search.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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
    client = TestClient(app)

    client.post("/api/posts", json={
        "title": "Python Tutorial",
        "slug": "python-tutorial",
        "content": "Learn Python programming",
        "published": True
    })
    client.post("/api/posts", json={
        "title": "JavaScript Guide",
        "slug": "javascript-guide",
        "content": "Learn JavaScript",
        "published": True
    })

    yield client
    Base.metadata.drop_all(bind=engine)

def test_search_posts(client):
    response = client.get("/api/search?q=Python")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1

def test_search_pagination(client):
    response = client.get("/api/search?q=Learn&page=1&limit=1")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1
    assert data["pagination"]["total"] == 2

def test_search_no_results(client):
    response = client.get("/api/search?q=nonexistent")
    assert response.status_code == 200
    assert len(response.json()["items"]) == 0
```

- [ ] **Step 2: 运行测试并提交**

```bash
cd backend && uv run pytest tests/test_search.py -v
git add backend/tests/test_search.py && git commit -m "test: add search API tests"
```

---

### Task 5: 前端 - CommentList 组件测试

**Files:**

- Create: `frontend/components/CommentList.test.tsx`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import CommentList from "./CommentList";
import { Comment } from "@/types";

const mockComments: Comment[] = [
  { id: 1, post_id: 1, author: "Alice", content: "Great post!", created_at: "2024-01-15T10:00:00Z" },
  { id: 2, post_id: 1, author: "Bob", content: "Thanks for sharing", created_at: "2024-01-16T10:00:00Z" },
];

describe("CommentList", () => {
  it("should render all comments", () => {
    render(<CommentList postId={1} />);
    expect(screen.getByText("Alice")).toBeDefined();
    expect(screen.getByText("Bob")).toBeDefined();
  });

  it("should display comment content", () => {
    render(<CommentList postId={1} />);
    expect(screen.getByText("Great post!")).toBeDefined();
    expect(screen.getByText("Thanks for sharing")).toBeDefined();
  });
});
```

- [ ] **Step 2: 添加 Comment 类型**

在 `frontend/types/index.ts` 添加：

```typescript
export interface Comment {
  id: number;
  post_id: number;
  author: string;
  content: string;
  created_at: string;
}
```

- [ ] **Step 3: 运行测试并提交**

```bash
cd frontend && pnpm test -- --run
git add frontend/components/CommentList.test.tsx frontend/types/index.ts
git commit -m "test: add CommentList component tests"
```

---

### Task 6: 前端 - CommentForm 组件测试

**Files:**

- Create: `frontend/components/CommentForm.test.tsx`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CommentForm from "./CommentForm";

describe("CommentForm", () => {
  it("should render form fields", () => {
    render(<CommentForm postId={1} />);

    expect(screen.getByPlaceholderText("你的昵称")).toBeDefined();
    expect(screen.getByPlaceholderText("发表评论")).toBeDefined();
    expect(screen.getByRole("button", { name: /提交评论/i })).toBeDefined();
  });

  it("should show validation errors on empty submit", async () => {
    const user = userEvent.setup();
    render(<CommentForm postId={1} />);

    await user.click(screen.getByRole("button", { name: /提交评论/i }));

    expect(screen.getByText("请输入昵称")).toBeDefined();
    expect(screen.getByText("请输入评论内容")).toBeDefined();
  });
});
```

- [ ] **Step 2: 安装 userEvent**

```bash
cd frontend && pnpm add -D @testing-library/user-event
```

- [ ] **Step 3: 运行测试并提交**

```bash
cd frontend && pnpm test -- --run
git add frontend/components/CommentForm.test.tsx
git commit -m "test: add CommentForm component tests"
```

---

### Task 7: 前端 - SearchBox 组件测试

**Files:**

- Create: `frontend/components/SearchBox.test.tsx`

- [ ] **Step 1: 创建测试文件**

```typescript
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import SearchBox from "./SearchBox";

const renderWithRouter = (ui: React.ReactElement) => {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe("SearchBox", () => {
  it("should render search input", () => {
    renderWithRouter(<SearchBox />);
    expect(screen.getByPlaceholderText("搜索文章...")).toBeDefined();
  });

  it("should show input value", async () => {
    const user = userEvent.setup();
    renderWithRouter(<SearchBox />);

    const input = screen.getByPlaceholderText("搜索文章...");
    await user.type(input, "test");

    expect(input).toHaveValue("test");
  });
});
```

- [ ] **Step 2: 运行测试并提交**

```bash
cd frontend && pnpm test -- --run
git add frontend/components/SearchBox.test.tsx
git commit -m "test: add SearchBox component tests"
```

---

## 验证

完成所有任务后：

```bash
cd /var/tmp/aurora && just test
cd frontend && pnpm build
```

**目标测试数量：**

- Backend: 5 + 5 + 4 + 3 + 3 = 20 tests
- Frontend: 14 + 2 + 2 + 2 = 20 tests
- Total: 40 tests
