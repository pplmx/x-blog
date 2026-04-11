# X-Blog 分类/标签筛选实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现首页文章按分类/标签筛选功能

**Architecture:** 后端 API 支持查询参数，前端添加筛选组件和侧边栏

**Tech Stack:** FastAPI, SQLAlchemy, Next.js, React

---

## 文件结构

```
backend/
├── app/
│   ├── crud.py            # 修改: get_posts 添加筛选参数
│   └── routers/posts.py   # 修改: list_posts 添加查询参数

frontend/
├── app/
│   └── page.tsx           # 修改: 添加筛选逻辑
├── components/
│   ├── Sidebar.tsx        # 新建: 侧边栏组件
│   └── FilterBar.tsx      # 新建: 顶部筛选组件
└── lib/
    └── api.ts             # 修改: fetchPosts 支持筛选参数
```

---

### Task 1: 后端 - 更新 CRUD 支持筛选

**Files:**
- Modify: `backend/app/crud.py`

- [ ] **Step 1: 更新 get_posts 函数**

修改 `backend/app/crud.py` 的 `get_posts` 函数，添加 `category_id` 和 `tag_id` 参数：

```python
def get_posts(
    db: Session,
    skip: int = 0,
    limit: int = 10,
    published: bool = True,
    category_id: Optional[int] = None,
    tag_id: Optional[int] = None,
) -> List[models.Post]:
    query = db.query(models.Post)
    
    if published:
        query = query.filter(models.Post.published == True)
    
    if category_id:
        query = query.filter(models.Post.category_id == category_id)
    
    if tag_id:
        query = query.join(models.Post.tags).filter(models.Tag.id == tag_id).distinct()
    
    return query.offset(skip).limit(limit).all()
```

- [ ] **Step 2: 提交**

```bash
git add backend/app/crud.py && git commit -m "feat: add category/tag filter to get_posts"
```

---

### Task 2: 后端 - 更新路由支持查询参数

**Files:**
- Modify: `backend/app/routers/posts.py`

- [ ] **Step 1: 更新 list_posts 函数**

修改 `backend/app/routers/posts.py` 的 `list_posts` 函数：

```python
@router.get("", response_model=List[schemas.PostList])
def list_posts(
    skip: int = 0,
    limit: int = 10,
    category_id: Optional[int] = None,
    tag_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    posts = crud.get_posts(
        db,
        skip=skip,
        limit=limit,
        category_id=category_id,
        tag_id=tag_id,
    )
    return posts
```

注意：需要添加 `Optional` 导入：
```python
from typing import List, Optional
```

- [ ] **Step 2: 测试**

```bash
cd backend && uv run uvicorn app.main:app --reload --port 8000

# 测试
curl "http://localhost:8000/api/posts?category_id=1"
curl "http://localhost:8000/api/posts?tag_id=1"
```

- [ ] **Step 3: 提交**

```bash
git add backend/app/routers/posts.py && git commit -m "feat: add query params for category/tag filter"
```

---

### Task 3: 前端 - 更新 API 客户端

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: 更新 fetchPosts 函数**

修改 `frontend/lib/api.ts`：

```typescript
export async function fetchPosts(filters?: {
  category_id?: number;
  tag_id?: number;
}): Promise<PostList[]> {
  const params = new URLSearchParams();
  if (filters?.category_id) params.set("category_id", String(filters.category_id));
  if (filters?.tag_id) params.set("tag_id", String(filters.tag_id));
  
  const query = params.toString();
  const url = query ? `/api/posts?${query}` : "/api/posts";
  
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/lib/api.ts && git commit -m "feat: add filter params to fetchPosts"
```

---

### Task 4: 前端 - 创建侧边栏组件

**Files:**
- Create: `frontend/components/Sidebar.tsx`

- [ ] **Step 1: 创建 Sidebar 组件**

```typescript
"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";

interface Category {
  id: number;
  name: string;
}

interface Tag {
  id: number;
  name: string;
}

interface SidebarProps {
  categories: Category[];
  tags: Tag[];
}

export default function Sidebar({ categories, tags }: SidebarProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const currentCategory = searchParams.get("category_id");
  const currentTag = searchParams.get("tag_id");

  const clearFilters = () => {
    router.push("/");
  };

  return (
    <aside className="w-64 shrink-0">
      {(currentCategory || currentTag) && (
        <button
          onClick={clearFilters}
          className="mb-4 text-sm text-blue-600 hover:underline"
        >
          ← 清除筛选
        </button>
      )}
      
      <div className="mb-6">
        <h3 className="font-semibold mb-2">分类</h3>
        <div className="space-y-1">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/?category_id=${cat.id}`}
              className={`block px-2 py-1 rounded text-sm hover:bg-gray-100 ${
                currentCategory === String(cat.id) ? "bg-blue-100" : ""
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </div>
      
      <div>
        <h3 className="font-semibold mb-2">标签</h3>
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Link
              key={tag.id}
              href={`/?tag_id=${tag.id}`}
              className={`px-2 py-1 rounded text-xs ${
                currentTag === String(tag.id)
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              {tag.name}
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/components/Sidebar.tsx && git commit -m "feat: add Sidebar component with category/tag filter"
```

---

### Task 5: 前端 - 更新首页集成筛选

**Files:**
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: 更新首页**

修改 `frontend/app/page.tsx`：

```typescript
import { fetchPosts, fetchCategories, fetchTags } from "@/lib/api";
import PostCard from "@/components/PostCard";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category_id?: string; tag_id?: string }>;
}) {
  const params = await searchParams;
  const categoryId = params.category_id ? parseInt(params.category_id) : undefined;
  const tagId = params.tag_id ? parseInt(params.tag_id) : undefined;

  const [posts, categories, tags] = await Promise.all([
    fetchPosts({ category_id: categoryId, tag_id: tagId }),
    fetchCategories(),
    fetchTags(),
  ]);

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
      </div>
      <Sidebar categories={categories} tags={tags} />
    </div>
  );
}
```

- [ ] **Step 2: 添加 fetchCategories 和 fetchTags**

更新 `frontend/lib/api.ts`：

```typescript
export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch("/api/categories");
  if (!res.ok) throw new Error("Failed to fetch categories");
  return res.json();
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch("/api/tags");
  if (!res.ok) throw new Error("Failed to fetch tags");
  return res.json();
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/app/page.tsx frontend/lib/api.ts && git commit -m "feat: integrate category/tag filter to homepage"
```

---

## 验证

完成所有任务后，验证：
1. 访问 http://localhost:3000
2. 侧边栏显示分类和标签
3. 点击分类/标签，文章列表筛选
4. URL 参数同步（如 ?category_id=1）
5. 清除筛选返回全部文章

```bash
# 启动后端
cd backend && uv run uvicorn app.main:app --reload --port 8000

# 启动前端
cd frontend && pnpm dev
```