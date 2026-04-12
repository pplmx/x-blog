# 测试覆盖增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将测试总数从 42 提升到 87 (后端 45 + 前端 42)

**Architecture:** 修复 admin 测试隔离问题，添加 auth/search 单元测试，添加前端 hooks/api/组件测试

**Tech Stack:** pytest, React Testing Library, MSW, Vitest

---

## 文件结构

### 后端

- `backend/tests/test_auth.py` (新建)
- `backend/tests/test_admin.py` (修复)
- `backend/app/auth.py` (依赖)
- `backend/app/routers/search.py` (测试)

### 前端

- `frontend/lib/hooks.test.ts` (新建)
- `frontend/lib/api.test.ts` (新建)
- `frontend/components/Header.test.tsx` (新建)
- `frontend/components/Footer.test.tsx` (新建)
- `frontend/mocks/handlers.ts` (扩展)

---

## 阶段 1: 后端测试 (24 tests)

### Task 1: 修复 admin 测试隔离

**Files:**

- Create: `backend/tests/test_admin.py`
- Modify: `backend/pyproject.toml`
- Test: `backend/tests/test_admin.py`

- [ ] **Step 1: 创建 test_admin.py 文件**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.auth import get_password_hash, User
import app.auth
from app.main import app
from app import models

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_admin_isolated.db"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(autouse=True)
def setup_database():
    import app.auth
    import app.models
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def admin_user():
    db = TestingSessionLocal()
    user = User(
        username="admin",
        password=get_password_hash("admin123"),
        is_superuser=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.close()
    return user


@pytest.fixture
def admin_token(client, admin_user):
    response = client.post(
        "/api/admin/login",
        data={"username": "admin", "password": "admin123"},
    )
    return response.json()["access_token"]


@pytest.fixture
def auth_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


class TestAdminLogin:
    def test_login_success(self, client, admin_user):
        response = client.post(
            "/api/admin/login",
            data={"username": "admin", "password": "admin123"},
        )
        assert response.status_code == 200
        assert "access_token" in response.json()

    def test_login_wrong_password(self, client, admin_user):
        response = client.post(
            "/api/admin/login",
            data={"username": "admin", "password": "wrong"},
        )
        assert response.status_code == 401

    def test_login_nonexistent_user(self, client):
        response = client.post(
            "/api/admin/login",
            data={"username": "nonexistent", "password": "password"},
        )
        assert response.status_code == 401


class TestAdminPosts:
    def test_list_posts(self, client, auth_headers, admin_user):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        db.close()

        response = client.get("/api/admin/posts", headers=auth_headers)
        assert response.status_code == 200
        posts = response.json()
        assert len(posts) == 1

    def test_create_post(self, client, auth_headers):
        response = client.post(
            "/api/admin/posts",
            headers=auth_headers,
            json={
                "title": "New Post",
                "slug": "new-post",
                "content": "Post content",
                "published": True,
            },
        )
        assert response.status_code == 200
        assert response.json()["id"] == 1

    def test_get_post(self, client, auth_headers):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        post_id = post.id
        db.close()

        response = client.get(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["title"] == "Test"

    def test_update_post(self, client, auth_headers):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        post_id = post.id
        db.close()

        response = client.put(
            f"/api/admin/posts/{post_id}",
            headers=auth_headers,
            json={"title": "Updated Title", "slug": "updated-slug"},
        )
        assert response.status_code == 200

    def test_delete_post(self, client, auth_headers):
        db = TestingSessionLocal()
        post = models.Post(title="Test", slug="test", content="Content", published=True)
        db.add(post)
        db.commit()
        post_id = post.id
        db.close()

        response = client.delete(f"/api/admin/posts/{post_id}", headers=auth_headers)
        assert response.status_code == 200

    def test_list_posts_unauthorized(self, client):
        response = client.get("/api/admin/posts")
        assert response.status_code == 401


class TestAdminCategories:
    def test_list_categories(self, client, auth_headers):
        db = TestingSessionLocal()
        category = models.Category(name="Test Category")
        db.add(category)
        db.commit()
        db.close()

        response = client.get("/api/admin/categories", headers=auth_headers)
        assert response.status_code == 200

    def test_create_category(self, client, auth_headers):
        response = client.post(
            "/api/admin/categories?name=New%20Category",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_delete_category(self, client, auth_headers):
        db = TestingSessionLocal()
        category = models.Category(name="Test")
        db.add(category)
        db.commit()
        cat_id = category.id
        db.close()

        response = client.delete(f"/api/admin/categories/{cat_id}", headers=auth_headers)
        assert response.status_code == 200


class TestAdminTags:
    def test_list_tags(self, client, auth_headers):
        db = TestingSessionLocal()
        tag = models.Tag(name="Test Tag")
        db.add(tag)
        db.commit()
        db.close()

        response = client.get("/api/admin/tags", headers=auth_headers)
        assert response.status_code == 200

    def test_create_tag(self, client, auth_headers):
        response = client.post(
            "/api/admin/tags?name=New%20Tag",
            headers=auth_headers,
        )
        assert response.status_code == 200

    def test_delete_tag(self, client, auth_headers):
        db = TestingSessionLocal()
        tag = models.Tag(name="Test")
        db.add(tag)
        db.commit()
        tag_id = tag.id
        db.close()

        response = client.delete(f"/api/admin/tags/{tag_id}", headers=auth_headers)
        assert response.status_code == 200
```

- [ ] **Step 2: 运行 admin 测试验证隔离修复**

Run: `cd backend && rm -f test_admin_isolated.db && uv run pytest tests/test_admin.py -v`
Expected: 15 passed

- [ ] **Step 3: 验证不与其他测试冲突**

Run: `cd backend && rm -f test.db test_admin_isolated.db && uv run pytest tests/test_admin.py tests/test_posts.py -v`
Expected: 20 passed (15 admin + 5 posts)

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_admin.py
git commit -m "test: add admin tests with isolated database"
```

### Task 2: 添加 auth 单元测试

**Files:**

- Create: `backend/tests/test_auth.py`
- Modify: `backend/app/auth.py`
- Test: `backend/tests/test_auth.py`

- [ ] **Step 1: 创建 test_auth.py**

```python
import pytest
from app.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    TokenData,
)
from jose import jwt, JWTError


class TestAuth:
    def test_verify_password_correct(self):
        hashed = get_password_hash("testpass123")
        assert verify_password("testpass123", hashed) is True

    def test_verify_password_wrong(self):
        hashed = get_password_hash("testpass123")
        assert verify_password("wrongpass", hashed) is False

    def test_get_password_hash(self):
        password = "testpassword"
        hashed = get_password_hash(password)
        assert hashed != password
        assert len(hashed) > 0

    def test_create_access_token(self):
        token = create_access_token({"sub": 1})
        assert token is not None
        assert isinstance(token, str)

        payload = jwt.decode(token, "x-blog-secret-key-change-in-production", algorithms=["HS256"])
        assert payload["sub"] == "1"

    def test_token_data(self):
        data = TokenData(user_id=1)
        assert data.user_id == 1


class TestAuthEdgeCases:
    def test_verify_password_empty(self):
        hashed = get_password_hash("")
        assert verify_password("", hashed) is True

    def test_create_access_token_empty_sub(self):
        token = create_access_token({})
        assert token is not None
```

- [ ] **Step 2: 运行 auth 测试**

Run: `cd backend && uv run pytest tests/test_auth.py -v`
Expected: 6 passed

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_auth.py
git commit -m "test: add auth unit tests"
```

### Task 3: 添加 search 边界测试

**Files:**

- Modify: `backend/tests/test_search.py`
- Test: `backend/tests/test_search.py`

- [ ] **Step 1: 添加边界测试到 test_search.py**

在文件末尾添加：

```python
def test_search_empty_query(client):
    response = client.get("/api/search?q=")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data


def test_search_special_characters(client):
    db = SessionLocal()
    post = models.Post(
        title="Test Special",
        slug="test-special",
        content="Content with special chars: @#$%^&*()",
        published=True,
    )
    db.add(post)
    db.commit()
    db.close()

    response = client.get("/api/search?q=@#$%")
    assert response.status_code == 200


def test_search_case_insensitive(client):
    db = SessionLocal()
    post = models.Post(
        title="Hello World",
        slug="hello-world",
        content="Hello content",
        published=True,
    )
    db.add(post)
    db.commit()
    db.close()

    response = client.get("/api/search?q=hello")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 1

    response_upper = client.get("/api/search?q=HELLO")
    data_upper = response_upper.json()
    assert len(data_upper["items"]) == 1
```

- [ ] **Step 2: 运行 search 测试**

Run: `cd backend && uv run pytest tests/test_search.py -v`
Expected: 6 passed (原有 3 + 新增 3)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_search.py
git commit -m "test: add search edge case tests"
```

## 阶段 2: 前端测试 (21 tests)

### Task 4: 添加前端 hooks 测试

**Files:**

- Create: `frontend/lib/hooks.test.ts`
- Modify: `frontend/lib/hooks.ts`
- Test: `frontend/lib/hooks.test.ts`

- [ ] **Step 1: 创建 hooks.test.ts**

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePosts, usePost, useCategories, useTags } from './hooks';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('usePosts', () => {
  it('fetches posts with default params', async () => {
    const { result } = renderHook(() => usePosts({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
  });

  it('fetches posts with pagination', async () => {
    const { result } = renderHook(() => usePosts({ page: 2, limit: 5 }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('fetches posts with category filter', async () => {
    const { result } = renderHook(() => usePosts({ category_id: 1 }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('usePost', () => {
  it('fetches single post by slug', async () => {
    const { result } = renderHook(() => usePost('test-slug'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useCategories', () => {
  it('fetches categories', async () => {
    const { result } = renderHook(() => useCategories(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Array.isArray(result.current.data)).toBe(true);
  });
});

describe('useTags', () => {
  it('fetches tags', async () => {
    const { result } = renderHook(() => useTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true});
    expect(Array.isArray(result.current.data)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行 hooks 测试**

Run: `cd frontend && pnpm vitest run lib/hooks.test.ts`
Expected: 7 passed

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/hooks.test.ts
git commit -m "test: add hooks unit tests"
```

### Task 5: 添加前端 API 测试

**Files:**

- Create: `frontend/lib/api.test.ts`
- Test: `frontend/lib/api.test.ts`

- [ ] **Step 1: 创建 api.test.ts**

```typescript
import { describe, it, expect, vi } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { fetchPosts, fetchPost, createPost, updatePost, deletePost } from './api';

describe('API Error Handling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetchPosts handles errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchPosts({})).rejects.toThrow('Network error');
  });

  it('fetchPost returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const result = await fetchPost('nonexistent');
    expect(result).toBeNull();
  });

  it('createPost throws on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    });

    await expect(createPost({ title: 'Test', slug: 'test', content: 'Content' }))
      .rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行 API 测试**

Run: `cd frontend && pnpm vitest run lib/api.test.ts`
Expected: 4 passed

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/api.test.ts
git commit -m "test: add API error handling tests"
```

### Task 6: 添加前端组件测试

**Files:**

- Create: `frontend/components/Header.test.tsx`
- Create: `frontend/components/Footer.test.tsx`
- Test: `frontend/components/*.test.tsx`

- [ ] **Step 1: 创建 Header.test.tsx**

```typescript
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { usePathname } from 'next/navigation';
import Header from './Header';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

describe('Header', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/');
  });

  it('renders logo link', () => {
    render(<Header />);
    expect(screen.getByText('X-Blog')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<Header />);
    expect(screen.getByText('首页')).toBeInTheDocument();
    expect(screen.getByText('关于')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 创建 Footer.test.tsx**

```typescript
import { render, screen } from '@testing-library/react';
import Footer from './Footer';

describe('Footer', () => {
  it('renders copyright text', () => {
    render(<Footer />);
    expect(screen.getByText(/©/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 运行组件测试**

Run: `cd frontend && pnpm vitest run components/Header.test.tsx components/Footer.test.tsx`
Expected: 3 passed

- [ ] **Step 4: Commit**

```bash
git add frontend/components/Header.test.tsx frontend/components/Footer.test.tsx
git commit -m "test: add Header and Footer component tests"
```

## 验收

- [ ] 后端测试: 21 → 45 (+24)
- [ ] 前端测试: 21 → 42 (+21)
- [ ] 所有测试通过: `pnpm test`
- [ ] Lint 通过: `pnpm lint`

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-11-test-coverage.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
