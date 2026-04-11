# X-Blog 分页实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现文章列表分页功能

**Architecture:** 后端返回分页元数据，前端渲染分页组件

**Tech Stack:** FastAPI, SQLAlchemy, Next.js, React

---

## 文件结构

```
backend/
├── app/
│   ├── schemas.py       # 修改: 添加分页响应 schema
│   ├── crud.py         # 修改: 返回总数
│   └── routers/posts.py # 修改: 添加分页参数

frontend/
├── components/
│   └── Pagination.tsx  # 新建: 分页组件
└── app/
    └── page.tsx        # 修改: 集成分页
```

---

### Task 1: 后端 - 添加分页 Schema

**Files:**
- Modify: `backend/app/schemas.py`

- [ ] **Step 1: 添加分页响应 Schema**

```python
class PaginationMeta(BaseModel):
    total: int
    page: int
    limit: int
    total_pages: int

class PostListResponse(BaseModel):
    items: List[PostList]
    pagination: PaginationMeta
```

- [ ] **Step 2: 提交**

```bash
git add backend/app/schemas.py && git commit -m "feat: add pagination schema"
```

---

### Task 2: 后端 - CRUD 返回总数

**Files:**
- Modify: `backend/app/crud.py`

- [ ] **Step 1: 修改 get_posts 返回总数**

添加返回类型和总数：

```python
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
```

- [ ] **Step 2: 提交**

```bash
git add backend/app/crud.py && git commit -m "feat: get_posts returns total count"
```

---

### Task 3: 后端 - 路由返回分页元数据

**Files:**
- Modify: `backend/app/routers/posts.py`

- [ ] **Step 1: 修改 list_posts**

```python
@router.get("", response_model=schemas.PostListResponse)
def list_posts(
    page: int = 1,
    limit: int = 10,
    category_id: Optional[int] = None,
    tag_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    skip = (page - 1) * limit
    posts, total = crud.get_posts(
        db,
        skip=skip,
        limit=limit,
        category_id=category_id,
        tag_id=tag_id,
    )
    
    total_pages = (total + limit - 1) // limit
    
    return {
        "items": posts,
        "pagination": {
            "total": total,
            "page": page,
            "limit": limit,
            "total_pages": total_pages,
        }
    }
```

- [ ] **Step 2: 测试**

```bash
curl "http://localhost:8000/api/posts?page=1&limit=5"
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/routers/posts.py && git commit -m "feat: add pagination to posts endpoint"
```

---

### Task 4: 前端 - API 更新

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: 更新 fetchPosts**

```typescript
export interface PostListResponse {
  items: PostList[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

export async function fetchPosts(filters?: {
  category_id?: number;
  tag_id?: number;
  page?: number;
  limit?: number;
}): Promise<PostListResponse> {
  const params = new URLSearchParams();
  if (filters?.category_id) params.set("category_id", String(filters.category_id));
  if (filters?.tag_id) params.set("tag_id", String(filters.tag_id));
  if (filters?.page) params.set("page", String(filters.page));
  if (filters?.limit) params.set("limit", String(filters.limit));
  
  const query = params.toString();
  const url = query ? `/api/posts?${query}` : "/api/posts";
  
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/lib/api.ts && git commit -m "feat: update fetchPosts for pagination"
```

---

### Task 5: 前端 - 分页组件

**Files:**
- Create: `frontend/components/Pagination.tsx`

- [ ] **Step 1: 创建 Pagination 组件**

```typescript
"use client";

import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

export default function Pagination({ currentPage, totalPages, baseUrl }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-8">
      {currentPage > 1 && (
        <Link
          href={`${baseUrl}?page=${currentPage - 1}`}
          className="px-3 py-1 border rounded hover:bg-gray-100"
        >
          上一页
        </Link>
      )}
      
      {pages.map((page) => (
        <Link
          key={page}
          href={`${baseUrl}?page=${page}`}
          className={`px-3 py-1 border rounded ${
            page === currentPage
              ? "bg-blue-600 text-white"
              : "hover:bg-gray-100"
          }`}
        >
          {page}
        </Link>
      ))}
      
      {currentPage < totalPages && (
        <Link
          href={`${baseUrl}?page=${currentPage + 1}`}
          className="px-3 py-1 border rounded hover:bg-gray-100"
        >
          下一页
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/components/Pagination.tsx && git commit -m "feat: add Pagination component"
```

---

### Task 6: 前端 - 首页集成

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: 更新首页**

```typescript
import { fetchPosts } from "@/lib/api";
import PostCard from "@/components/PostCard";
import Pagination from "@/components/Pagination";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category_id?: string; tag_id?: string; page?: string }>;
}) {
  const params = await searchParams;
  const categoryId = params.category_id ? parseInt(params.category_id) : undefined;
  const tagId = params.tag_id ? parseInt(params.tag_id) : undefined;
  const page = params.page ? parseInt(params.page) : 1;

  const { items: posts, pagination } = await fetchPosts({
    category_id: categoryId,
    tag_id: tagId,
    page,
    limit: 10,
  });

  // 获取分类和标签（仅首页需要）
  const baseUrl = categoryId 
    ? `/?category_id=${categoryId}` 
    : tagId 
      ? `/?tag_id=${tagId}` 
      : "/";

  return (
    <div className="flex gap-8">
      <div className="flex-1">
        <h1 className="text-3xl font-bold mb-8">
          {categoryId || tagId ? "筛选结果" : "最新文章"}
        </h1>
        <div className="grid gap-6">
          {posts.length === 0 ? (
            <p className="text-gray-500">暂无文章</p>
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} />)
          )}
        </div>
        <Pagination 
          currentPage={pagination.page} 
          totalPages={pagination.total_pages} 
          baseUrl={baseUrl}
        />
      </div>
      {/* 侧边栏逻辑需要调整，这里简化处理 */}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/app/page.tsx && git commit -m "feat: integrate pagination to homepage"
```

---

## 验证

完成所有任务后，验证：
1. 访问 http://localhost:3000
2. 文章分页显示
3. 点击页码能切换
4. URL 参数同步（?page=2）
5. 筛选 + 分页组合工作

```bash
cd backend && uv run uvicorn app.main:app --reload --port 8000
cd frontend && pnpm dev
```