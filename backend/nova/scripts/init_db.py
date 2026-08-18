#!/usr/bin/env python
"""Initialize database with sample data and demo posts."""

import os
import sys
import warnings
from datetime import UTC, datetime, timedelta

sys.path.insert(0, ".")
from alembic import command
from alembic.config import Config

from app import auth, models
from app.config import is_development
from app.database import SessionLocal

DEV_ADMIN_PASSWORD = "admin123"

DEMO_POSTS = [
    {
        "title": "欢迎使用 X-Blog — 现代化技术博客系统",
        "slug": "welcome-to-x-blog",
        "excerpt": "X-Blog 是一个基于 FastAPI + Nuxt 4 构建的现代化博客系统。本文介绍核心功能与使用方法。",
        "content": """# 欢迎使用 X-Blog

X-Blog 是一个基于 **FastAPI** + **Nuxt 4** 构建的现代化技术博客系统。

## 核心功能

- **Markdown 编辑** — 支持 GFM 标准 Markdown
- **代码高亮** — 支持 100+ 编程语言
- **Mermaid 图表** — 流程图、时序图、甘特图
- **KaTeX 数学公式** — 行内公式和块级公式
- **图片上传** — 拖拽/粘贴自动上传
- **i18n** — 支持中/英文界面
- **全文搜索** — 快速找到所需内容

## 快速开始

```bash
# 启动开发服务器
just dev
```

```python
# FastAPI 示例
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello, X-Blog!"}
```

## Mermaid 图表

```mermaid
graph LR
    A[用户] -->|浏览| B[前端 Nuxt]
    B -->|API 请求| C[后端 FastAPI]
    C -->|查询| D[(PostgreSQL)]
```

## 数学公式

行内公式: $E = mc^2$

块级公式:

$$
\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}
$$

## 图片

![X-Blog Logo](https://placehold.co/800x400/3b82f6/ffffff?text=X-Blog)

欢迎使用 X-Blog！部署前请务必通过环境变量 `ADMIN_PASSWORD` 修改管理员密码，详见部署文档。
""",
        "published": True,
        "pinned": True,
        "category": "技术分享",
        "tags": ["FastAPI", "Nuxt", "TypeScript", "Vue"],
        "cover_image": "https://images.unsplash.com/photo-1571173371547-20c6a4591a5c?w=800&h=400&fit=crop&q=80",
        "views": 1280,
        "likes": 42,
        "created_days_ago": 7,
    },
    {
        "title": "Python 3.14 新特性速览",
        "slug": "python-3-14-new-features",
        "excerpt": "Python 3.14 带来了多项令人兴奋的新特性，包括更好的模式匹配、性能优化和类型系统改进。",
        "content": """# Python 3.14 新特性速览

Python 3.14 已于近期发布，带来了多项改进。

## 模式匹配增强

```python
def process_value(value):
    match value:
        case int() as n if n > 0:
            return f"正数: {n}"
        case int() as n if n < 0:
            return f"负数: {n}"
        case str() as s:
            return f"字符串: {s}"
        case _:
            return "未知类型"
```

## 性能提升

```python
from time import perf_counter

# Python 3.14 中字典操作提速约 15-20%
data = {i: i ** 2 for i in range(10000)}
start = perf_counter()
_ = [data[i] for i in range(10000)]
print(f"耗时: {perf_counter() - start:.4f}s")
```

## 类型系统改进

```python
from typing import TypedDict

class User(TypedDict):
    name: str
    age: int
    email: str | None
```

## 数学公式

时间复杂度分析:

$$
T(n) = O(n \\log n)
$$

```mermaid
timeline
    title Python 版本演进
    2020 : 3.9 : 类型提示泛型
    2021 : 3.10 : 模式匹配
    2022 : 3.11 : 异常组
    2023 : 3.12 : 更快的 CPython
    2025 : 3.13 : JIT 编译
    2026 : 3.14 : 性能优化
```

升级到 Python 3.14 非常简单：

```bash
uv python install 3.14
```
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Python", "FastAPI"],
        "cover_image": "https://images.unsplash.com/photo-1555066931-4365d6f70f12?w=800&h=400&fit=crop&q=80",
        "views": 856,
        "likes": 28,
        "created_days_ago": 3,
    },
    {
        "title": "Nuxt 4 迁移指南：从 Nuxt 3 到 Nuxt 4",
        "slug": "nuxt-3-to-4-migration-guide",
        "excerpt": "Nuxt 4 带来了目录结构变更和性能提升。本文详解迁移步骤和注意事项。",
        "content": """# Nuxt 4 迁移指南

Nuxt 4 是 Vue 全栈框架的重大更新，引入了新的目录约定和性能优化。

## 主要变化

### 目录结构

```
app/                  # 新增！应用代码目录
├── pages/           # 页面组件
├── layouts/         # 布局组件
├── components/      # 组件
└── app.vue         # 根组件
server/              # 服务端代码
composables/         # 组合函数
```

### 自动导入

Nuxt 4 增强了自动导入功能：

```vue
<script setup lang="ts">
// 无需手动 import
const { data: posts } = await usePosts()
const { data: categories } = await useCategories()
</script>
```

### 性能对比

```mermaid
xychart-beta
    title "Nuxt 3 vs Nuxt 4 构建性能"
    x-axis ["Nuxt 3", "Nuxt 4"]
    y-axis "构建时间 (秒)" 0 --> 12
    bar [10, 6]
```

## 迁移步骤

1. **升级依赖**

```bash
pnpm add nuxt@latest
```

2. **调整目录结构**

```bash
mkdir -p app/pages app/layouts
mv pages/* app/pages/
mv layouts/* app/layouts/
```

3. **更新配置**

```ts
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  future: {
    compatibilityVersion: 4,
  },
})
```

## 代码示例

```typescript
// server/api/posts.ts
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const posts = await $fetch(`http://backend:18888/api/posts`, {
    params: query,
  })
  return posts
})
```

Nuxt 4 的迁移虽然有一定工作量，但带来的性能提升和开发体验改善是值得的。
""",
        "published": True,
        "pinned": False,
        "category": "前端开发",
        "tags": ["Vue", "Nuxt", "TypeScript", "JavaScript"],
        "cover_image": "https://images.unsplash.com/photo-1555066931-4365d6f70f12?w=800&h=400&fit=crop&q=80",
        "views": 2340,
        "likes": 56,
        "created_days_ago": 5,
    },
    {
        "title": "深入理解 FastAPI 的依赖注入系统",
        "slug": "fastapi-dependency-injection-deep-dive",
        "excerpt": "FastAPI 的依赖注入系统是其最强大的特性之一。本文从源码层面分析其实现原理和最佳实践。",
        "content": """# 深入理解 FastAPI 的依赖注入系统

FastAPI 的依赖注入 (DI) 系统是其核心特性，本文将深入分析其工作原理。

## 基础概念

```python
from fastapi import Depends, FastAPI

app = FastAPI()

async def common_parameters(q: str | None = None, skip: int = 0, limit: int = 100):
    return {"q": q, "skip": skip, "limit": limit}

@app.get("/items/")
async def read_items(commons: dict = Depends(common_parameters)):
    return commons
```

## 依赖链

```mermaid
graph TD
    A[路由函数] -->|Depends| B[数据库会话]
    A -->|Depends| C[当前用户]
    B -->|Depends| D[数据库引擎]
    C -->|Depends| E[JWT 解析]
    C -->|Depends| B
```

## 高级用法

### 可调用类

```python
class Pagination:
    def __init__(self, page: int = 1, limit: int = 20):
        self.page = page
        self.limit = limit
        self.skip = (page - 1) * limit

@app.get("/posts")
def list_posts(pagination: Pagination = Depends()):
    return get_posts(skip=pagination.skip, limit=pagination.limit)
```

### 带参数的依赖

```python
def require_role(role: str):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role != role:
            raise HTTPException(status_code=403)
        return current_user
    return role_checker

@app.get("/admin")
def admin_only(user: User = Depends(require_role("admin"))):
    return {"message": "Welcome admin!"}
```

## 性能

FastAPI 的 DI 系统非常高效，请求处理时间几乎不受依赖链长度影响：

$$
O(1) \\text{ per dependency}
$$

## 最佳实践

1. 使用 `yield` 管理资源生命周期
2. 避免过深的依赖链（不超过 5 层）
3. 使用 `Annotated` 类型提示提高可读性

```python
from typing import Annotated

DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]

@app.get("/profile")
def get_profile(db: DbSession, user: CurrentUser):
    return db.query(User).filter(User.id == user.id).first()
```

FastAPI 的 DI 系统设计优雅且高效，是构建大型应用的基础。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Python", "FastAPI"],
        "cover_image": "https://images.unsplash.com/photo-1542744095-fcf48d8090fd?w=800&h=400&fit=crop&q=80",
        "views": 1890,
        "likes": 63,
        "created_days_ago": 10,
    },
    {
        "title": "TypeScript 5.x 实用技巧 20 则",
        "slug": "typescript-5-practical-tips",
        "excerpt": "精选 20 个 TypeScript 5.x 实用技巧，涵盖类型体操、工具类型、性能优化等方面。",
        "content": """# TypeScript 5.x 实用技巧 20 则

本文精选了 20 个 TypeScript 5.x 的实用技巧。

## 1. const 类型参数

```typescript
function tuple<T extends readonly string[]>(...args: T): T {
  return args
}

// 类型为 readonly ["a", "b", "c"]
const result = tuple("a", "b", "c")
```

## 2. 装饰器进化

```typescript
function log(target: any, propertyKey: string) {
  console.log(`Called: ${propertyKey}`)
}

class Calculator {
  @log
  add(a: number, b: number): number {
    return a + b
  }
}
```

## 3. 类型谓词

```typescript
type Fish = { swim: () => void }
type Bird = { fly: () => void }

function isFish(pet: Fish | Bird): pet is Fish {
  return (pet as Fish).swim !== undefined
}
```

## 使用技巧统计

```mermaid
pie
    title TypeScript 技巧分布
    "类型体操" : 35
    "工具类型" : 25
    "性能优化" : 20
    "工程实践" : 20
```

## 4. 模板字面量类型

```typescript
type EventName<T extends string> = `on${Capitalize<T>}`
type ClickEvent = EventName<"click"> // "onClick"
```

## 性能对比

JavaScript 运行时类型体操的性能开销：

$$
\\text{Overhead} = O(1) \\text{ at runtime}
$$

TypeScript 的类型系统在编译时求值，运行时零开销。

## 5. satisfies 操作符

```typescript
const palette = {
  red: [255, 0, 0],
  green: "#00ff00",
} satisfies Record<string, string | number[]>

// palette.red 类型为 number[]（保留窄类型）
// palette.green 类型为 string
```

## 6. 递归条件类型

```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object
    ? DeepReadonly<T[P]>
    : T[P]
}
```

掌握这些技巧可以显著提升 TypeScript 开发效率和代码质量。
""",
        "published": True,
        "pinned": False,
        "category": "前端开发",
        "tags": ["TypeScript", "JavaScript"],
        "cover_image": "https://images.unsplash.com/photo-1542744095-fcf48d8090fd?w=800&h=400&fit=crop&q=80",
        "views": 3200,
        "likes": 89,
        "created_days_ago": 15,
    },
    {
        "title": "PostgreSQL 性能调优实战",
        "slug": "postgresql-performance-tuning",
        "excerpt": "从连接池配置到查询优化，全面讲解 PostgreSQL 在生产环境中的性能调优经验。",
        "content": """# PostgreSQL 性能调优实战

本文分享 PostgreSQL 在生产环境中的性能调优经验。

## 连接池配置

```python
# database.py
_pool_opts = {
    "pool_size": 10,       # 最小连接数
    "max_overflow": 20,    # 最大溢出连接
    "pool_pre_ping": True, # 连接健康检查
    "pool_recycle": 3600,  # 连接回收时间
}
```

## 全文搜索

```sql
-- 创建搜索索引
CREATE INDEX idx_posts_search ON posts
USING GIN (to_tsvector('english', title || ' ' || content));
```

```mermaid
flowchart LR
    A[用户搜索] --> B[ts_query解析]
    B --> C[ts_vector匹配]
    C --> D[ts_rank排序]
    D --> E[ts_headline高亮]
    E --> F[返回结果]
```

## 索引优化

```sql
-- 复合索引
CREATE INDEX idx_posts_published_created
ON posts (published, created_at DESC);

-- 部分索引
CREATE INDEX idx_posts_published_true
ON posts (created_at DESC)
WHERE published = true;
```

## 查询性能公式

$$
\\text{Query Time} = \\frac{\\text{Table Size}}{\\text{Index Selectivity} \\times \\text{IO Throughput}}
$$

## 配置对比

```mermaid
xychart-beta
    title "配置优化前后查询延迟对比"
    x-axis ["优化前", "优化后"]
    y-axis "延迟 (ms)" 0 --> 200
    bar [180, 25]
```

## EXPLAIN ANALYZE

```sql
EXPLAIN ANALYZE
SELECT * FROM posts
WHERE published = true
  AND (publish_at IS NULL OR publish_at <= NOW())
ORDER BY pinned DESC, created_at DESC
LIMIT 20;
```

合理的索引设计和连接池配置可以让 PostgreSQL 性能提升 5-10 倍。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Python", "数据库", "FastAPI"],
        "cover_image": "https://images.unsplash.com/photo-1542744095-fcf48d8090fd?w=800&h=400&fit=crop&q=80",
        "views": 1500,
        "likes": 45,
        "created_days_ago": 8,
    },
    {
        "title": "CSS 新特性：Container Queries 实战",
        "slug": "css-container-queries-practical",
        "excerpt": "Container Queries 是 CSS 近年来最重要的更新之一。本文通过实战案例讲解其用法。",
        "content": """# CSS Container Queries 实战

Container Queries 让组件可以根据容器大小而非视口大小来调整样式。

## 基础用法

```css
.card-container {
  container-type: inline-size;
  container-name: card;
}

@container card (max-width: 400px) {
  .card {
    flex-direction: column;
  }
  .card-image {
    width: 100%;
  }
}
```

## Vue 组件示例

```vue
<script setup lang="ts">
defineProps<{
  title: string
  description: string
  image: string
}>()
</script>

<template>
  <div class="card-container">
    <div class="card">
      <img :src="image" class="card-image" />
      <div class="card-body">
        <h3>{{ title }}</h3>
        <p>{{ description }}</p>
      </div>
    </div>
  </div>
</template>
```

## 响应式策略

```mermaid
flowchart TD
    A[组件渲染] --> B{容器宽度}
    B -->|< 400px| C[垂直布局]
    B -->|400-800px| D[水平布局]
    B -->|> 800px| E[网格布局]
    C --> F[小图/精简文字]
    D --> G[中图/完整文字]
    E --> H[大图/丰富展示]
```

## 与 Media Queries 的对比

| 特性 | Media Queries | Container Queries |
|------|--------------|-------------------|
| 依据 | 视口大小 | 容器大小 |
| 复用性 | 低 | 高 |
| 组件独立 | 否 | 是 |
| 浏览器支持 | 全支持 | 现代浏览器 |

## 性能考量

Container Queries 的性能开销极小：

$$
\\text{Layout Cost} = O(n) \\times \\text{containers}
$$

Container Queries 是现代 CSS 布局的革新，让真正的组件级响应式成为现实。
""",
        "published": True,
        "pinned": False,
        "category": "前端开发",
        "tags": ["CSS", "JavaScript", "Vue"],
        "cover_image": "https://images.unsplash.com/photo-1571173371547-20c6a4591a5c?w=800&h=400&fit=crop&q=80",
        "views": 670,
        "likes": 22,
        "created_days_ago": 2,
    },
    {
        "title": "Redis 缓存策略在 Web 应用中的实践",
        "slug": "redis-caching-strategies",
        "excerpt": "本文介绍 Redis 在 Web 应用中的常见缓存模式，包括缓存穿透、缓存雪崩的解决方案。",
        "content": """# Redis 缓存策略实践

本文介绍 Redis 在 Web 应用中的常见缓存模式。

## 缓存模式

### Cache-Aside

```python
def get_post(db: Session, post_id: int) -> Post:
    # 1. 尝试从缓存获取
    cached = redis.get(f"post:{post_id}")
    if cached:
        return json.loads(cached)

    # 2. 缓存未命中，查询数据库
    post = db.query(Post).filter(Post.id == post_id).first()

    # 3. 写入缓存
    if post:
        redis.setex(f"post:{post_id}", 3600, json.dumps(post.to_dict()))

    return post
```

## 缓存策略选择

```mermaid
flowchart LR
    subgraph 读策略
        A[读请求] --> B{缓存命中?}
        B -->|是| C[返回缓存]
        B -->|否| D[查数据库]
        D --> E[更新缓存]
        E --> C
    end
    subgraph 写策略
        F[写请求] --> G[更新数据库]
        G --> H[删除/更新缓存]
    end
```

## 异常场景处理

### 缓存穿透

```python
def get_post_safe(db: Session, post_id: int) -> Post | None:
    # 布隆过滤器前置检查
    if not bloom_filter.might_contain(f"post:{post_id}"):
        return None

    return get_post(db, post_id)
```

### 缓存雪崩

```python
# 过期时间添加随机偏移
import random

def set_cache(key: str, value: Any, base_ttl: int = 3600):
    jitter = random.uniform(0, 300)  # 0-5分钟随机偏移
    redis.setex(key, int(base_ttl + jitter), json.dumps(value))
```

## 性能指标

合理的缓存策略可以显著提升性能：

$$
\\text{Read Latency}_{\\text{cached}} = 1\\text{ms} \\ll \\text{Read Latency}_{\\text{db}} = 50\\text{ms}
$$

## 缓存统计

```mermaid
xychart-beta
    title "缓存命中率统计"
    x-axis ["周一", "周二", "周三", "周四", "周五"]
    y-axis "命中率 %" 0 --> 100
    line [92, 94, 89, 95, 93]
```

合理使用缓存可以让应用性能提升 10-50 倍，同时降低数据库负载。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["Python", "数据库", "FastAPI"],
        "cover_image": "https://images.unsplash.com/photo-1542744095-fcf48d8090fd?w=800&h=400&fit=crop&q=80",
        "views": 1100,
        "likes": 34,
        "created_days_ago": 12,
    },
    {
        "title": "算法学习笔记：动态规划入门",
        "slug": "dynamic-programming-intro",
        "excerpt": "动态规划是算法面试中的重中之重。本文从经典案例入手，帮助你建立 DP 解题思维。",
        "content": """# 动态规划入门

动态规划 (Dynamic Programming) 是算法面试中最重要的题型之一。

## 核心思想

动态规划的核心是**将复杂问题分解为子问题**，并通过记录子问题的解来避免重复计算。

## 经典案例：斐波那契数列

```python
# 递归（指数级复杂度）
def fib_recursive(n: int) -> int:
    if n <= 1:
        return n
    return fib_recursive(n - 1) + fib_recursive(n - 2)

# 动态规划（线性复杂度）
def fib_dp(n: int) -> int:
    if n <= 1:
        return n
    dp = [0] * (n + 1)
    dp[1] = 1
    for i in range(2, n + 1):
        dp[i] = dp[i - 1] + dp[i - 2]
    return dp[n]
```

## 复杂度对比

$$
\\begin{aligned}
\\text{递归: } & T(n) = O(2^n) \\\\
\\text{DP: } & T(n) = O(n)
\\end{aligned}
$$

```mermaid
xychart-beta
    title "递归 vs DP 执行时间对比"
    x-axis ["n=10", "n=20", "n=30", "n=40"]
    y-axis "时间 (ms)" 0 --> 1000
    line [0.01, 0.1, 1, 100]
    line [0.01, 0.02, 0.03, 0.04]
```

## DP 解题模板

```python
def solve_dp(problem):
    # 1. 定义状态
    dp = [0] * n

    # 2. 初始化
    dp[0] = base_case

    # 3. 状态转移
    for i in range(1, n):
        dp[i] = f(dp[i-1])

    # 4. 返回结果
    return dp[n-1]
```

## 常见 DP 题型

| 类型 | 状态定义 | 转移方程 |
|------|---------|---------|
| 斐波那契 | dp[n] | dp[i] = dp[i-1] + dp[i-2] |
| 背包问题 | dp[i][w] | dp[i][w] = max(dp[i-1][w], dp[i-1][w-wi] + vi) |
| LCS | dp[i][j] | dp[i][j] = dp[i-1][j-1] + 1 (if equal) |
| 最长递增子序列 | dp[i] | dp[i] = max(dp[j] + 1) |

掌握 DP 需要大量练习，但一旦建立了解题思维，你会发现大多数 DP 问题都有迹可循。
""",
        "published": True,
        "pinned": False,
        "category": "学习笔记",
        "tags": ["Python"],
        "cover_image": "https://images.unsplash.com/photo-1542744095-fcf48d8090fd?w=800&h=400&fit=crop&q=80",
        "views": 2800,
        "likes": 72,
        "created_days_ago": 20,
    },
    {
        "title": "即将发布：GraphQL 在微服务架构中的实践",
        "slug": "graphql-microservices-practices",
        "excerpt": "本文探讨 GraphQL 在微服务架构中的落地实践，包括 schema 设计、数据聚合、性能优化等话题。",
        "content": """# GraphQL 在微服务架构中的实践

本文探讨 GraphQL 在微服务架构中的应用。

> 本文将在 **2026年8月1日** 正式发布，敬请期待！

## 预告内容

### Schema 设计

```graphql
type Query {
  post(id: ID!): Post
  posts(page: Int, limit: Int): PostList
}

type Post {
  id: ID!
  title: String!
  content: String!
  author: User
  comments: [Comment]
}
```

### Apollo Federation

```mermaid
graph LR
    A[Gateway] --> B[Posts Service]
    A --> C[Users Service]
    A --> D[Comments Service]
    B --> E[(Posts DB)]
    C --> F[(Users DB)]
    D --> G[(Comments DB)]
```

更多内容将在正式发布后更新。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["Python", "FastAPI"],
        "cover_image": "https://images.unsplash.com/photo-1542744095-fcf48d8090fd?w=800&h=400&fit=crop&q=80",
        "views": 340,
        "likes": 15,
        "created_days_ago": 1,
        "publish_at_days_from_now": 4,
    },
    {
        "title": "草稿：Vue 3 组合式 API 最佳实践",
        "slug": "vue3-composition-api-best-practices",
        "excerpt": "这是一篇未完成的文章草稿，用于测试草稿功能。",
        "content": """# Vue 3 Composition API 最佳实践

本文正在编写中...

## 内容规划

1. setup 函数的最佳用法
2. ref vs reactive 的选择
3. 自定义组合函数设计模式
4. 组件通信策略

<!-- TODO: 补充完整内容 -->
""",
        "published": False,
        "pinned": False,
        "category": "前端开发",
        "tags": ["Vue", "TypeScript", "JavaScript"],
        "cover_image": "https://images.unsplash.com/photo-1571173371547-20c6a4591a5c?w=800&h=400&fit=crop&q=80",
        "views": 0,
        "likes": 0,
        "created_days_ago": 0,
    },
    # ─── Additional posts for pagination demonstration ──────────────────────
    {
        "title": "React Hooks 最佳实践：从入门到进阶",
        "slug": "react-hooks-best-practices",
        "excerpt": "React Hooks 改变了我们写组件的方式。本文总结官方文档和社区的最佳实践，帮助你避免常见陷阱。",
        "content": """# React Hooks 最佳实践

React Hooks 自 16.8 发布以来，已成为函数组件的标准。

## 基本原则

1. **只在顶层调用 Hook** — 不要在循环、条件或嵌套函数中调用
2. **只在 React 函数中调用 Hook** — 在自定义 Hook 中调用其他 Hook

## useState

```jsx
function Counter() {
  const [count, setCount] = useState(0)

  // 推荐：使用函数形式更新
  const increment = () => setCount(prev => prev + 1)
}
```

## useEffect

```jsx
// 正确：指定依赖数组
useEffect(() => {
  document.title = `Count: ${count}`
}, [count])

// 清除副作用
useEffect(() => {
  const timer = setInterval(() => {}, 1000)
  return () => clearInterval(timer)
}, [])
```

## 自定义 Hook

```jsx
function useDebounce(value, delay) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(handler)
  }, [value, delay])

  return debounced
}
```

## 性能优化

- 使用 `useMemo` 缓存 expensive 计算
- 使用 `useCallback` 避免子组件不必要的重新渲染
- 使用 `React.memo` 浅层比较 props

```mermaid
flowchart LR
    A[State 更新] --> B[re-render]
    B --> C{是否变化?}
    C -->|是| D[更新子组件]
    C -->|否| E[跳过]
```

遵循这些原则可以写出更可维护、性能更好的 React 代码。
""",
        "published": True,
        "pinned": False,
        "category": "前端开发",
        "tags": ["React", "TypeScript", "JavaScript"],
        "cover_image": "https://images.unsplash.com/photo-1555066931-4365d6f70f12?w=800&h=400&fit=crop&q=80",
        "views": 1200,
        "likes": 38,
        "created_days_ago": 14,
    },
    {
        "title": "Docker 在开发环境中的实践与优化",
        "slug": "docker-development-practices",
        "excerpt": "Docker 不仅在生产环境有用，合理的开发环境容器化可以显著提升团队开发效率。",
        "content": """# Docker 在开发环境中的实践

## Docker Compose 配置

```yaml
version: "3.9"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
    command: pnpm dev

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: xblog
      POSTGRES_PASSWORD: xblog
      POSTGRES_DB: xblog
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## 开发体验优化

### 1. 热重载

```dockerfile
# Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

### 2. 多环境配置

```bash
# .env.development
NODE_ENV=development
DB_HOST=db
```

```bash
# .env.production
NODE_ENV=production
DB_HOST=prod-db
```

## 常见问题

### 缓存失效

```dockerfile
# 将 package.json 分离，减少层缓存
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
```

### 文件监听权限

在 macOS 上，需要添加:

```yaml
volumes:
  - .:/app:delegated
```

Docker 可以让每个开发者在 5 分钟内搭建完整的开发环境。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Docker", "DevOps"],
        "cover_image": "https://images.unsplash.com/photo-1542744095-fcf48d8090fd?w=800&h=400&fit=crop&q=80",
        "views": 890,
        "likes": 25,
        "created_days_ago": 18,
    },
    {
        "title": "Webpack 5 构建优化完全指南",
        "slug": "webpack-5-build-optimization",
        "excerpt": "从基础配置到高级优化，掌握 Webpack 5 的 Tree Shaking、Code Splitting 和持久化缓存。",
        "content": """# Webpack 5 构建优化

## 基础优化

### Tree Shaking

```js
// webpack.config.js
module.exports = {
  mode: "production",
  optimization: {
    usedExports: true,
    sideEffects: false, // 在 package.json 中声明
  },
}
```

### Code Splitting

```js
// 动态导入
const LazyComponent = lazy(() => import("./LazyComponent"))

// SplitChunks
module.exports = {
  optimization: {
    splitChunks: {
      chunks: "all",
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: "vendors",
          chunks: "all",
        },
      },
    },
  },
}
```

## 性能优化

### 持久化缓存

```js
module.exports = {
  cache: {
    type: "filesystem",
    buildDependencies: {
      config: [__filename],
    },
  },
}
```

### 压缩优化

```js
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin")
const TerserPlugin = require("terser-webpack-plugin")

module.exports = {
  optimization: {
    minimizer: [
      new TerserPlugin(),
      new CssMinimizerPlugin(),
    ],
  },
}
```

## Bundle 分析

```bash
npx webpack-bundle-analyzer dist/stats.json
```

优化后的构建时间通常可以减少 50% 以上。
""",
        "published": True,
        "pinned": False,
        "category": "前端开发",
        "tags": ["Vue", "TypeScript", "Webpack"],
        "cover_image": "https://images.unsplash.com/photo-1571173371547-20c6a4591a5c?w=800&h=400&fit=crop&q=80",
        "views": 760,
        "likes": 22,
        "created_days_ago": 25,
    },
    {
        "title": "Git 进阶：分支策略与代码协作",
        "slug": "git-branching-strategies",
        "excerpt": "掌握 Git Flow、GitHub Flow 和 GitLab Flow 分支策略，提升团队协作效率。",
        "content": """# Git 进阶：分支策略

## Git Flow

```mermaid
gitGraph
    commit
    branch develop
    checkout develop
    commit
    checkout main
    branch release/v1.0
    checkout release/v1.0
    commit
    checkout main
    merge release/v1.0
    checkout develop
    merge release/v1.0
    branch hotfix/server-error
    checkout hotfix/server-error
    commit
    checkout main
    merge hotfix/server-error
    checkout develop
    merge hotfix/server-error
```

## GitHub Flow

1. 从 `main` 分支创建一个功能分支
2. 在功能分支上开发和测试
3. 创建 Pull Request
4. 代码审查通过后合并到 `main`
5. 部署到生产环境

## 常用技巧

### 暂存部分更改

```bash
git add -p  # 交互式暂存
```

### 修改最后一次提交

```bash
git commit --amend  # 修改提交信息
```

### 找回丢失的分支

```bash
git reflog  # 查看所有操作记录
git checkout -b recovered <commit-hash>
```

### 拉取请求的最佳实践

- 保持 PR 尽可能小
- 使用语义化的分支名: `feat/add-user-auth`
- 提交信息遵循规范: `feat: 添加用户认证模块`

```mermaid
flowchart LR
    A[功能开发] --> B[代码审查]
    B --> C{是否通过?}
    C -->|否| D[修改代码]
    D --> B
    C -->|是| E[合并到 main]
```

好的分支策略可以减少代码冲突，提升开发效率。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["Git", "DevOps"],
        "cover_image": "https://placehold.co/800x400/8b5cf6/ffffff?text=Git+Flow",
        "views": 450,
        "likes": 18,
        "created_days_ago": 22,
    },
    {
        "title": "HTTP 性能优化：从 TCP 到 TLS 的调优策略",
        "slug": "http-performance-optimization",
        "excerpt": "了解 HTTP/1.1、HTTP/2、HTTP/3 的差异，掌握 CDN、缓存和压缩的最佳实践。",
        "content": r"""# HTTP 性能优化

## HTTP 版本对比

| 特性 | HTTP/1.1 | HTTP/2 | HTTP/3 |
|------|----------|--------|--------|
| 多路复用 | ❌ | ✅ | ✅ |
| 头部压缩 | ❌ | ✅ | ✅ |
| 服务器推送 | ❌ | ✅ | ✅ |
| TCP 队头阻塞 | ❌ | ❌ | ✅ |

## 请求优化

### 减少请求数量

```nginx
# 资源合并
location /static/ {
  concat on;
  concat_max_files 20;
}
```

### 缓存策略

```nginx
location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
  expires 1y;
  add_header Cache-Control "public, immutable";
}
```

## 压缩优化

### Gzip 配置

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript;
gzip_proxied expired no-cache no-store private auth;
```

### Brotli（更好的压缩算法）

```nginx
brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css application/json application/javascript;
```

## TLS 优化

### HTTPS 安全

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
ssl_prefer_server_ciphers off;
```

```mermaid
xychart-beta
    title "压缩率对比"
    x-axis ["Gzip", "Brotli"]
    y-axis "压缩率 %" 0 --> 100
    bar [70, 85]
```

优化后的页面加载速度通常可以提升 30-50%。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Nginx", "HTTP", "DevOps"],
        "cover_image": "https://placehold.co/800x400/10b981/ffffff?text=HTTP+Optimization",
        "views": 920,
        "likes": 30,
        "created_days_ago": 9,
    },
    {
        "title": "微前端架构：Module Federation 实践",
        "slug": "micro-frontend-module-federation",
        "excerpt": "学习如何使用 Webpack 5 的 Module Federation 实现微前端架构，实现团队独立部署。",
        "content": """# 微前端架构：Module Federation

## 什么是微前端

微前端（Micro Frontends）将微服务理念扩展到前端，每个团队可以独立开发和部署前端应用。

## Module Federation 配置

### 主机应用（主机）

```js
// webpack.config.js (主机)
const ModuleFederationPlugin = require("@module-federation/enhanced")

module.exports = {
  name: "host",
  plugins: [
    new ModuleFederationPlugin({
      name: "host",
      remotes: {
        "remote-app": "remote_app@http://localhost:3001/remoteEntry.js",
      },
      shared: ["vue", "pinia"],
    }),
  ],
}
```

### 远程应用

```js
// webpack.config.js (远程)
module.exports = {
  name: "remote_app",
  plugins: [
    new ModuleFederationPlugin({
      name: "remote_app",
      filename: "remoteEntry.js",
      exposes: {
        "./UserProfile": "./src/components/UserProfile.vue",
        "./ProductCard": "./src/components/ProductCard.vue",
      },
      shared: ["vue", "pinia"],
    }),
  ],
}
```

## 使用远程组件

```vue
<script setup lang="ts">
// 动态导入远程组件
const UserProfile = defineAsyncComponent(
  () => __webpack_init_sharing__("default").then(() =>
    import("remote_app/UserProfile")
  )
)
</script>

<template>
  <UserProfile :user="currentUser" />
</template>
```

## 通信机制

### 事件通信

```js
// 使用 EventEmitter
import EventEmitter from "eventemitter3"

const emitter = new EventEmitter()

emitter.emit("user-updated", user)
emitter.on("user-updated", (user) => {
  // 处理用户更新
})
```

### 共享状态

```js
// 使用 Pinia 共享状态
const useSharedStore = defineStore("shared", {
  state: () => ({
    theme: "light",
    locale: "zh-CN",
  }),
})
```

```mermaid
graph LR
    A[Host App] -- HTTP --> B[Remote 1]
    A -- HTTP --> C[Remote 2]
    A -- HTTP --> D[Remote 3]
    B -- Share --> A
    C -- Share --> A
    D -- Share --> A
```

微前端架构带来了团队自治，但也带来了复杂性，需要权衡使用。
""",
        "published": True,
        "pinned": False,
        "category": "前端开发",
        "tags": ["Webpack", "Vue", "TypeScript"],
        "cover_image": "https://placehold.co/800x400/8b5cf6/ffffff?text=Micro+Frontend",
        "views": 630,
        "likes": 20,
        "created_days_ago": 11,
    },
    {
        "title": "Node.js 性能调优实战",
        "slug": "nodejs-performance-tuning",
        "excerpt": "从内存泄漏到 CPU 性能，从 V8 优化到异步模型，掌握 Node.js 性能调优的各种技巧。",
        "content": """# Node.js 性能调优

## 内存优化

### 内存泄漏排查

```bash
# 查看内存使用
node --inspect app.js
chrome://inspect
```

```js
// 内存泄漏常见场景
const cache = new Map() // 没有清理策略
const listeners = [] // 事件监听器未移除

// 解决方案
const cache = new Map()
setInterval(() => {
  cache.clear()
}, 60000)
```

### V8 堆内存

```bash
# 增加 V8 堆内存
node --max-old-space-size=4096 app.js
```

## 异步优化

### 避免阻塞

```js
// ❌ 阻塞事件循环
const data = fs.readFileSync("file.json")

// ✅ 非阻塞
const data = await fs.promises.readFile("file.json")
```

### 连接池

```js
const pool = mysql.createPool({
  connectionLimit: 10,
  host: "localhost",
  user: "root",
  password: "password",
  database: "mydb",
})
```

## 性能监控

### 基本指标

```js
const startTime = process.hrtime.bigint()

app.use((req, res, next) => {
  const start = process.hrtime.bigint()

  res.on("finish", () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e6
    console.log(`${req.method} ${req.url} - ${duration}ms`)
  })

  next()
})
```

### 压力测试

```bash
# 使用 wrk 进行压测
wrk -t12 -c400 -d30s http://localhost:3000/api/posts
```

```mermaid
xychart-beta
    title "Node.js 性能优化前后对比"
    x-axis ["优化前", "优化后"]
    y-axis "响应时间 (ms)" 0 --> 200
    bar [150, 25]
```

Node.js 性能优化通常可以提升 3-10 倍。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Node.js", "JavaScript"],
        "cover_image": "https://placehold.co/800x400/06b6d4/ffffff?text=Node.js+Performance",
        "views": 580,
        "likes": 19,
        "created_days_ago": 13,
    },
    {
        "title": "数据库索引设计原则与实践",
        "slug": "database-index-design",
        "excerpt": "从 B+ 树原理到慢查询优化，掌握数据库索引的设计原则和性能调优技巧。",
        "content": """# 数据库索引设计

## 索引类型

### 主键索引

```sql
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(255) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### 复合索引

```sql
-- 遵循最左前缀原则
CREATE INDEX idx_posts_status_created
ON posts (status, created_at DESC)
```

### 覆盖索引

```sql
-- 覆盖索引避免回表查询
CREATE INDEX idx_posts_cover
ON posts (status, created_at DESC)
INCLUDE (title, excerpt)
```

## 索引优化

### 查询计划分析

```sql
EXPLAIN ANALYZE
SELECT * FROM posts
WHERE status = 'published'
ORDER BY created_at DESC
LIMIT 10
```

### 慢查询优化

```sql
-- 添加分页优化
CREATE INDEX idx_posts_published_created
ON posts (published, created_at DESC)
WHERE published = true
```

### 索引失效场景

```sql
-- ❌ 使用函数会失效
WHERE YEAR(created_at) = 2024

-- ✅ 使用范围查询
WHERE created_at >= '2024-01-01'
  AND created_at < '2025-01-01'
```

## 性能监控

```sql
-- 查看索引使用情况
SELECT
  schemaname,
  tablename,
  indexname,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
```

```mermaid
flowchart LR
    A[SQL 查询] --> B[查询优化器]
    B --> C{是否使用索引?}
    C -->|是| D[索引扫描]
    C -->|否| E[全表扫描]
    D --> F[回表]
    E --> F
    F --> G[返回结果]
```

合理的索引设计可以将查询性能提升 10-100 倍。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["数据库", "PostgreSQL", "FastAPI"],
        "cover_image": "https://placehold.co/800x400/0ea5e9/ffffff?text=Database+Index",
        "views": 720,
        "likes": 24,
        "created_days_ago": 17,
    },
    {
        "title": "API 安全最佳实践：从 JWT 到 OAuth",
        "slug": "api-security-best-practices",
        "excerpt": "掌握 API 身份认证、授权、输入验证、速率限制等安全知识，构建安全可靠的 API。",
        "content": """# API 安全最佳实践

## 身份认证

### JWT

```js
const jwt = require("jsonwebtoken")

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  )
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return null
  }
}
```

### OAuth 2.0

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant A as Auth Server
    participant R as Resource Server

    U->>C: 访问受保护资源
    C->>A: 跳转到授权页
    U->>A: 授权
    A->>C: 返回授权码
    C->>A: 交换 Access Token
    C->>R: 携带 Access Token
    R->>C: 返回资源
```

## 输入验证

### 参数校验

```typescript
import { z } from "zod"

const PostSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  publish_at: z.date().optional(),
})

app.post("/api/posts", (req, res) => {
  const result = PostSchema.safeParse(req.body)
  if (!result.success) {
    return res.status(400).json({ errors: result.error.errors })
  }
  // ...
})
```

## 速率限制

```typescript
import rateLimit from "express-rate-limit"

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 最大请求次数
  message: "请求过于频繁",
  standardHeaders: true,
  legacyHeaders: false,
})

app.use("/api/", limiter)
```

## 安全响应

```typescript
// 移除敏感字段
function toSafeJSON(post) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    created_at: post.created_at,
    // 不包含 password, internal_notes 等
  }
}
```

## HTTPS 配置

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
  ssl_prefer_server_ciphers off;

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options "nosniff";
  add_header X-Frame-Options "DENY";
}
```

遵循 OWASP Top 10 可以显著降低安全风险。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Security", "API", "JWT"],
        "cover_image": "https://placehold.co/800x400/ef4444/ffffff?text=API+Security",
        "views": 680,
        "likes": 28,
        "created_days_ago": 16,
    },
    {
        "title": "CI/CD 流水线实践：GitHub Actions 编排",
        "slug": "ci-cd-github-actions-practice",
        "excerpt": "从简单到复杂，掌握 GitHub Actions 的工作流编排，构建自动化测试和部署流水线。",
        "content": """# CI/CD：GitHub Actions 实践

## 基础工作流

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v7

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: |
          pip install -r backend/nova/requirements.txt

      - name: Run tests
        run: |
          cd backend/nova
          python -m pytest tests/
```

## 并行测试

```yaml
strategy:
  matrix:
    python-version: ["3.11", "3.12"]
    os: [ubuntu-latest, macos-latest]

steps:
  - uses: actions/setup-python@v5
    with:
      python-version: ${{ matrix.python-version }}
```

## 缓存优化

```yaml
- name: Cache dependencies
  uses: actions/cache@v4
  with:
    path: |
      ~/.cache/pip
      backend/nova/.venv
    key: ${{ runner.os }}-pip-${{ hashFiles('**/requirements.txt') }}
```

## 代码覆盖率

```yaml
- name: Upload coverage
  uses: codecov/codecov-action@v7
  with:
    files: ./coverage.xml
    token: ${{ secrets.CODECOV_TOKEN }}
```

## 部署工作流

```yaml
deploy:
  needs: test
  runs-on: ubuntu-latest
  if: github.ref == 'refs/heads/main'

  steps:
    - uses: actions/checkout@v7
    - name: Deploy to server
      run: |
        ssh deploy@server "docker-compose pull && docker-compose up -d"
```

```mermaid
flowchart LR
    A[推送代码] --> B[运行测试]
    B --> C{测试通过?}
    C -->|否| D[发送通知]
    C -->|是| E[部署到预览]
    E --> F[部署到生产]
```

CI/CD 可以将部署频率提高 10-100 倍。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["DevOps", "CI/CD"],
        "cover_image": "https://placehold.co/800x400/6366f1/ffffff?text=CI-CD",
        "views": 520,
        "likes": 16,
        "created_days_ago": 21,
    },
    {
        "title": "Vue 3 响应式系统原理剖析",
        "slug": "vue3-reactivity-system-analysis",
        "excerpt": "从 Vue 2 的 Object.defineProperty 到 Vue 3 的 Proxy，深入理解 Vue 响应式系统的实现原理。",
        "content": """# Vue 3 响应式系统原理

## Proxy vs Object.defineProperty

### Vue 2 (Object.defineProperty)

```js
// 只能监听属性的 get/set
// 无法监听数组的索引变化
// 需要特殊处理数组方法
const arr = [1, 2, 3]
arr[0] = 99  // ❌ 无法检测到
arr.length = 0  // ❌ 无法检测到
```

### Vue 3 (Proxy)

```js
// 监听整个对象
// 可以监听任何属性的变化
// 支持数组索引变化
const arr = [1, 2, 3]
arr[0] = 99  // ✅ 可以检测到
arr.length = 0  // ✅ 可以检测到
```

## 响应式实现

### effect 和依赖

```js
const targetMap = new WeakMap()

function getDep(target, key) {
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    depsMap = new Map()
    targetMap.set(target, depsMap)
  }
  let deps = depsMap.get(key)
  if (!deps) {
    deps = new Set()
    depsMap.set(key, deps)
  }
  return deps
}
```

### reactive

```js
function reactive(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      const res = Reflect.get(target, key, receiver)
      // 收集依赖
      track(target, key)
      return isObject(res) ? reactive(res) : res
    },
    set(target, key, value, receiver) {
      const res = Reflect.set(target, key, value, receiver)
      // 触发依赖
      trigger(target, key)
      return res
    },
  })
}
```

### effect

```js
let activeEffect = null

function effect(fn) {
  activeEffect = fn
  fn()
  activeEffect = null
}

// 在 get 中收集
function track(target, key) {
  const deps = getDep(target, key)
  if (activeEffect && !deps.has(activeEffect)) {
    deps.add(activeEffect)
  }
}

// 在 set 中触发
function trigger(target, key) {
  const deps = getDep(target, key)
  deps.forEach((effect) => effect())
}
```

```mermaid
flowchart LR
    A[Reactive] --> B[Proxy]
    B --> C{Get/Set?}
    C -->|Get| D[Track]
    C -->|Set| E[Trigger]
    D --> F[Effect Set]
    F --> G[Execute]
```

Vue 3 的响应式系统更高效、更轻量、更易于理解。
""",
        "published": True,
        "pinned": False,
        "category": "前端开发",
        "tags": ["Vue", "JavaScript", "TypeScript"],
        "cover_image": "https://placehold.co/800x400/3b82f6/ffffff?text=Vue3+Reactivity",
        "views": 980,
        "likes": 35,
        "created_days_ago": 6,
    },
    {
        "title": "监控可观测性实践：从日志到告警",
        "slug": "observability-monitoring-practice",
        "excerpt": "掌握应用监控的完整实践：日志收集、指标监控、分布式追踪和告警策略。",
        "content": """# 监控可观测性实践

## 三大支柱

```mermaid
pie
    title 可观测性三大支柱
    "Logs" : 33
    "Metrics" : 33
    "Traces" : 34
```

## 日志收集

### 结构化日志

```python
import structlog

logger = structlog.get_logger()

def handle_request(request_id, user_id, action):
    logger.info(
        "user_action",
        request_id=request_id,
        user_id=user_id,
        action=action,
        timestamp=datetime.now(UTC).isoformat(),
    )
```

### ELK Stack

```yaml
# docker-compose.yml
services:
  elasticsearch:
    image: elasticsearch:8
    environment:
      - discovery.type=single-node

  logstash:
    image: logstash:8
    volumes:
      - ./logstash.conf:/config/logstash.conf

  kibana:
    image: kibana:8
    depends_on: [elasticsearch]
```

## 指标监控

### Prometheus

```python
from prometheus_client import Counter, Histogram, start_http_server

REQUEST_COUNT = Counter("http_requests_total", "Total HTTP Requests")
REQUEST_DURATION = Histogram("http_request_duration_seconds", "Request Duration")

@app.before_request
def before_request():
    REQUEST_COUNT.inc()

@app.after_request
def after_request(response):
    REQUEST_DURATION.observe(response.duration)
    return response
```

## 分布式追踪

### OpenTelemetry

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind

tracer = trace.get_tracer(__name__)

@tracer.start_as_current_span("get_post", kind=SpanKind.SERVER)
def get_post(post_id: int):
    with tracer.start_as_current_span("database_query") as span:
        span.set_attribute("db.statement", "SELECT * FROM posts")
        post = db.execute(...)
    return post
```

## 告警策略

### 黄金信号

```yaml
# 告警规则
rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.05
    for: 5m
    labels:
      severity: page
    annotations:
      summary: "Error rate above 5%"
```

### 告警级别

| 级别 | 响应时间 | 处理方式 |
|------|----------|----------|
| Critical | 5 分钟 | 立即处理 |
| Warning | 30 分钟 | 计划处理 |
| Info | 2 小时 | 记录处理 |

```mermaid
flowchart LR
    A[指标采集] --> B[规则匹配]
    B --> C{符合告警?}
    C -->|是| D[发送通知]
    C -->|否| E[静默]
    D --> F[人工处理]
    F --> G[确认解决]
```

完善的监控体系可以将故障发现时间降低 90%。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["DevOps", "Linux", "Python"],
        "cover_image": "https://placehold.co/800x400/06b6d4/ffffff?text=Monitoring",
        "views": 410,
        "likes": 14,
        "created_days_ago": 24,
    },
    {
        "title": "测试策略：单元测试到 E2E 的实践",
        "slug": "testing-strategy-from-unit-to-e2e",
        "excerpt": "构建完整的测试体系，掌握单元测试、集成测试、模拟和 E2E 测试的最佳实践。",
        "content": r"""# 测试策略实践

## 测试金字塔

```mermaid
pie
    title 测试金字塔
    "E2E" : 5
    "Integration" : 15
    "Unit" : 80
```

## 单元测试

### Python（pytest）

```python
import pytest
from app.posts import get_post_by_slug

def test_get_post_returns_post():
    expected = Post(id=1, slug="test", title="Test")
    with patch("app.posts.db") as mock_db:
        mock_db.query.return_value.filter_by.return_value.first.return_value = expected
        result = get_post_by_slug("test")
        assert result == expected
```

### TypeScript（Vitest）

```typescript
import { describe, expect, it, vi } from "vitest"
import { getUser } from "~/server/api/user"

describe("getUser", () => {
  it("returns user when found", async () => {
    const mockUser = { id: 1, name: "Alice" }
    vi.mock("~~/utils/db", () => ({
      db: { user: { findUnique: vi.fn().mockResolvedValue(mockUser) } },
    }))

    const result = await getUser(1)
    expect(result).toEqual(mockUser)
  })
})
```

## 集成测试

```python
@pytest.fixture
def client():
    app = create_app(testing=True)
    with TestClient(app) as client:
        yield client

def test_create_post(client):
    response = client.post("/api/posts", json={
        "title": "Test Post",
        "content": "Content",
    })
    assert response.status_code == 201
    assert response.json()["title"] == "Test Post"
```

## 模拟策略

### Mock 和 Stub 的区别

```typescript
// Stub：提供预设的返回值
const mockDb = {
  findUser: vi.fn().mockResolvedValue({ id: 1, name: "Alice" }),
}

// Mock：验证调用行为
const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
}
expect(mockLogger.info).toHaveBeenCalledWith("user.created")
```

## E2E 测试

```typescript
// playwright.config.ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "e2e/",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
})

// e2e/posts.spec.ts
test("create and view post", async ({ page }) => {
  await page.goto("/admin/login")
  await page.fill('input[name="username"]', "admin")
  await page.fill('input[name="password"]', "admin123")
  await page.click("button[type="submit"]")

  await page.goto("/admin/posts/new")
  await page.fill('input[name="title"]', "E2E Post")
  await page.click("button[type="submit"]")

  await expect(page).toHaveURL(/\/posts\/e2e-post/)
})
```

```mermaid
flowchart LR
    A[单元测试] --> B[集成测试]
    B --> C[E2E 测试]
    C --> D[生产发布]
```

好的测试策略可以将 Bug 率降低 50-80%。
""",
        "published": True,
        "pinned": False,
        "category": "学习笔记",
        "tags": ["Python", "TypeScript", "Testing"],
        "cover_image": "https://placehold.co/800x400/84cc16/ffffff?text=Testing",
        "views": 540,
        "likes": 21,
        "created_days_ago": 23,
    },
    {
        "title": "架构设计原则：从 SOLID 到微服务",
        "slug": "software-architecture-principles",
        "excerpt": "掌握软件架构的设计原则，从 SOLID 面向对象设计到微服务架构的最佳实践。",
        "content": """# 软件架构设计原则

## SOLID 原则

### 单一职责原则 (SRP)

```python
# ❌ 违反 SRP
class UserService:
    def create_user(self, data):
        user = User(**data)
        db.session.add(user)
        send_email(user.email, "Welcome!")
        logger.info("User created")

# ✅ 遵循 SRP
class UserService:
    def create_user(self, data):
        return User(**data)

class EmailService:
    def send_welcome(self, email):
        send_email(email, "Welcome!")
```

### 开闭原则 (OCP)

```typescript
// ❌ 违反 OCP
function calculateArea(shape: Shape): number {
  if (shape.type === "circle") {
    return Math.PI * shape.radius ** 2
  } else if (shape.type === "rectangle") {
    return shape.width * shape.height
  }
}

// ✅ 遵循 OCP
interface Shape {
  area(): number
}

class Circle implements Shape {
  area() { return Math.PI * this.radius ** 2 }
}

class Rectangle implements Shape {
  area() { return this.width * this.height }
}
```

### 依赖倒置原则 (DIP)

```typescript
// ❌ 违反 DIP
class OrderService {
  private paymentGateway = new StripePaymentGateway()
}

// ✅ 遵循 DIP
class OrderService {
  constructor(private paymentGateway: PaymentGateway) {}
}
```

## 六边形架构

```mermaid
graph TD
    subgraph "六边形架构"
        A[应用核心] --> B[端口]
        B --> C[适配器]
        C --> D[数据库]
        C --> E[HTTP]
        C --> F[消息队列]
        C --> G[文件系统]
    end
```

## 微服务设计原则

### 单一职责

```
UserService      → 用户管理
OrderService     → 订单管理
ProductService   → 商品管理
PaymentService   → 支付处理
```

### 无共享数据库

```mermaid
graph LR
    A[UserService] -->|HTTP| B[OrderService]
    B -->|HTTP| C[PaymentService]
    A -.-> D[(User DB)]
    B -.-> E[(Order DB)]
    C -.-> F[(Payment DB)]
```

### 熔断器模式

```python
from circuitbreaker import circuit

@circuit(failure_threshold=5, expected_exception=ConnectionError)
def call_external_api():
    response = requests.get("https://api.example.com")
    response.raise_for_status()
    return response.json()
```

## 领域驱动设计

### 实体 vs 值对象

```python
# 实体：有唯一标识
class User:
    def __init__(self, user_id: str, name: str):
        self.user_id = user_id
        self.name = name

# 值对象：不可变，无标识
@value
class Money:
    amount: Decimal
    currency: str
```

### 聚合

```python
class Order:
    def __init__(self, order_id: str):
        self.order_id = order_id
        self._items: list[OrderItem] = []

    def add_item(self, product_id: str, quantity: int):
        # 聚合内部保证一致性
        if quantity <= 0:
            raise ValueError("Quantity must be positive")
        self._items.append(OrderItem(product_id, quantity))
```

遵循这些原则可以构建更可维护、可扩展的软件系统。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["Architecture", "Design"],
        "cover_image": "https://placehold.co/800x400/ec4899/ffffff?text=Architecture",
        "views": 880,
        "likes": 32,
        "created_days_ago": 28,
    },
    {
        "title": "代码重构：提高代码质量的 20 个技巧",
        "slug": "code-refactoring-20-tips",
        "excerpt": "掌握实用的代码重构技巧，从命名优化到设计模式，编写更干净更可维护的代码。",
        "content": """# 代码重构 20 个技巧

## 命名优化

### 1. 避开无意义的缩写

```python
# ❌
def calc(x, y):
    return x * y

# ✅
def calculate_area(width, height):
    return width * height
```

### 2. 布尔变量名以 is/has 开头

```python
# ❌
def valid_user(user):
    return user.is_active

# ✅
def is_valid_user(user):
    return user.is_active
```

## 结构优化

### 3. 提取函数

```python
# ❌
def process_order(order):
    # 20 行验证逻辑
    # 10 行计算逻辑
    # 15 行保存逻辑

# ✅
def process_order(order):
    validate_order(order)
    calculate_total(order)
    save_order(order)
```

### 4. 移除嵌套

```python
# ❌ 深层嵌套
def process(data):
    if data:
        if data.user:
            if data.user.active:
                # ...

# ✅ 早返回
def process(data):
    if not data:
        return
    if not data.user:
        return
    if not data.user.active:
        return
```

## 设计模式

### 5. 工厂模式

```python
class PaymentFactory:
    @staticmethod
    def create(type: str) -> Payment:
        if type == "wechat":
            return WeChatPayment()
        elif type == "alipay":
            return AlipayPayment()
        raise ValueError(f"Unknown payment type: {type}")
```

### 6. 策略模式

```python
class DiscountStrategy(ABC):
    @abstractmethod
    def apply(self, price: float) -> float:
        pass

class VipDiscount(DiscountStrategy):
    def apply(self, price: float) -> float:
        return price * 0.8
```

## 性能优化

### 7. 使用生成器

```python
# ❌ 加载全部数据
def get_users():
    return [User(u) for u in db.query("SELECT * FROM users")]

# ✅ 按需生成
def get_users():
    for row in db.query("SELECT * FROM users"):
        yield User(row)
```

### 8. 缓存优化

```python
from functools import lru_cache

@lru_cache(maxsize=128)
def get_config(key: str) -> dict:
    return db.query(f"SELECT * FROM config WHERE key = '{key}'")
```

### 9. 字符串拼接

```python
# ❌
result = ""
for item in items:
    result += item.name + ", "

# ✅
result = ", ".join(item.name for item in items)
```

### 10. 批量操作

```python
# ❌
for item in items:
    db.save(item)

# ✅
db.bulk_save(items)
```

## TypeScript 最佳实践

### 11. 使用 const 枚举

```typescript
const enum UserStatus {
  Active = "active",
  Inactive = "inactive",
}
```

### 12. 使用 satisfies 操作符

```typescript
const theme = {
  primary: "#3b82f6",
  secondary: "#6366f1",
} satisfies Record<string, string>
```

### 13. 类型收窄

```typescript
function process(value: string | number) {
  if (typeof value === "string") {
    // value 是 string
    return value.toUpperCase()
  }
  // value 是 number
  return value.toFixed(2)
}
```

## 代码整洁

### 14. 函数参数不超过 3 个

```python
# ❌
def create_user(name, age, email, phone, address):
    ...

# ✅
@dataclass
class UserCreate:
    name: str
    age: int
    email: str
    phone: str
    address: str

def create_user(data: UserCreate):
    ...
```

### 15. 删除死代码

```bash
# 使用 knip 检测死代码
npx knip
```

### 16. 使用 Guard 子句

```typescript
function divide(a: number, b: number): number {
  if (b === 0) throw new Error("Division by zero")
  return a / b
}
```

### 17. 错误处理

```python
# ✅ 显式错误处理
def transfer_money(from_user, to_user, amount):
    if amount <= 0:
        raise ValueError("Amount must be positive")

    if from_user.balance < amount:
        raise InsufficientBalanceError()

    from_user.balance -= amount
    to_user.balance += amount
```

### 18. 使用类型注解

```python
from typing import NamedTuple

class Point(NamedTuple):
    x: float
    y: float

def distance(p1: Point, p2: Point) -> float:
    return ((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2) ** 0.5
```

### 19. 代码复用

```typescript
# ✅ 提取共享逻辑
function usePagination<T>(fetchFn: (page: number) => Promise<T[]>) {
  // ...
}
```

### 20. 文档化

```python
def calculate_compound_interest(
    principal: float,
    rate: float,
    time: int,
) -> float:
    '''
    Calculate compound interest.

    Formula: A = P(1 + r)^t

    Args:
        principal: Initial amount (P)
        rate: Interest rate per period (r)
        time: Number of periods (t)

    Returns:
        Final amount (A)
    '''
    return principal * (1 + rate) ** time
```

持续重构可以显著提高代码质量，降低维护成本。
""",
        "published": True,
        "pinned": False,
        "category": "学习笔记",
        "tags": ["TypeScript", "Python", "Refactoring"],
        "cover_image": "https://placehold.co/800x400/f59e0b/ffffff?text=Refactoring",
        "views": 470,
        "likes": 17,
        "created_days_ago": 26,
    },
    {
        "title": "开发工具提效：VS Code 和 Neovim 双轮战",
        "slug": "developer-productivity-tools",
        "excerpt": "提升开发效率的工具配置，包括 VS Code 插件推荐、Neovim 高效操作和终端优化。",
        "content": """# 开发工具提效

## VS Code 配置

### 必装插件

| 插件 | 用途 | 推荐理由 |
|------|------|----------|
| Error Lens | 错误高亮 | 立即发现语法错误 |
| Todo Tree | TODO 管理 | 快速定位待办事项 |
| GitLens | Git 增强 | 查看代码历史 |
| Bracket Pair Colorizer | 括号配色 | 提升可读性 |

### 快捷键配置

```json
// keybindings.json
[
  {
    "key": "cmd+d",
    "command": "editor.action.addSelectionToNextFindMatch"
  },
  {
    "key": "cmd+shift+n",
    "command": "workbench.action.newWindow"
  }
]
```

### 工作区配置

```json
// settings.json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "emmet.includeLanguages": {
    "vue-html": "html",
    "razor": "html"
  }
}
```

## Neovim 配置

### init.lua

```lua
-- 基础配置
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2

-- 插件管理
require("lazy").setup({
  "nvim-telescope/telescope.nvim",
  "nvim-treesitter/nvim-treesitter",
  "lewis6991/gitsigns.nvim",
  "folke/trouble.nvim",
})
```

### 常用操作

```vim
" 文件操作
:w 保存  :q 退出  :wq 保存退出
:e 文件名  打开文件

" 搜索替换
/pattern  搜索
:%s/old/new/g  全局替换

" 窗口分割
:split  水平分割
:vsplit  垂直分割

" 插件
<leader>ff  查找文件
<leader>fg  搜索内容
<leader>bn  下一个标签
```

## 终端优化

### Zsh 配置

```bash
# ~/.zshrc
source ~/.zsh/plugins.zsh
source ~/.zsh/env.zsh

# 智能提示
source <(fig.sh zsh)

# Docker 别名
alias dc="docker compose"
alias dcu="docker compose up -d"
alias dcd="docker compose down"
```

### Tmux 配置

```bash
# ~/.tmux.conf
set -g prefix C-a
unbind C-b
bind-key C-a send-prefix

bind | split-window -h
bind - split-window -v

# 状态栏
set -g status-bg colour235
set -g status-fg colour137
```

```mermaid
flowchart LR
    A[VS Code] --> B[开发]
    C[Neovim] --> B
    B --> D[终端]
    D --> E[Docker]
    E --> F[部署]
```

好的开发环境可以提升 20-30% 的开发效率。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["Tools", "VSCode", "Neovim"],
        "cover_image": "https://placehold.co/800x400/10b981/ffffff?text=Dev+Tools",
        "views": 390,
        "likes": 15,
        "created_days_ago": 27,
    },
    {
        "title": "算法面试题解：滑动窗口和双指针",
        "slug": "algorithm-sliding-window-two-pointers",
        "excerpt": "掌握滑动窗口和双指针算法的解题技巧，解决字符串匹配、数组遍历等常见面试题。",
        "content": """# 滑动窗口与双指针

## 滑动窗口

### 基本模板

```python
def sliding_window(s: str, target: str) -> int:
    window = {}
    left, right = 0, 0
    result = 0

    while right < len(s):
        # 扩展窗口
        char = s[right]
        window[char] = window.get(char, 0) + 1
        right += 1

        # 收缩窗口
        while is_valid(window, target):
            # 更新结果
            result = min(result, right - left)

            # 缩小左边界
            left_char = s[left]
            window[left_char] -= 1
            if window[left_char] == 0:
                del window[left_char]
            left += 1

    return result
```

### 经典题目：最小覆盖子串

```python
def min_window(s: str, t: str) -> str:
    target_count = Counter(t)
    window_count = defaultdict(int)
    left = 0
    valid = 0
    min_len = float("inf")
    start = 0

    for right, char in enumerate(s):
        if char in target_count:
            window_count[char] += 1
            if window_count[char] == target_count[char]:
                valid += 1

        while valid == len(target_count):
            if right - left + 1 < min_len:
                min_len = right - left + 1
                start = left

            left_char = s[left]
            if left_char in target_count:
                if window_count[left_char] == target_count[left_char]:
                    valid -= 1
                window_count[left_char] -= 1
            left += 1

    return s[start:start + min_len] if min_len != float("inf") else ""
```

## 双指针

### 快慢指针

```python
# 链表判环（Floyd 算法）
def has_cycle(head: ListNode) -> bool:
    slow = fast = head

    while fast and fast.next:
        slow = slow.next
        fast = fast.next.next

        if slow == fast:
            return True

    return False
```

### 对撞指针

```python
# 二分查找
def binary_search(nums: list[int], target: int) -> int:
    left, right = 0, len(nums) - 1

    while left <= right:
        mid = (left + right) // 2

        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1

    return -1
```

### 三数之和

```python
def three_sum(nums: list[int]) -> list[list[int]]:
    nums.sort()
    result = []

    for i in range(len(nums)):
        if i > 0 and nums[i] == nums[i - 1]:
            continue

        left, right = i + 1, len(nums) - 1

        while left < right:
            total = nums[i] + nums[left] + nums[right]

            if total == 0:
                result.append([nums[i], nums[left], nums[right]])
                left += 1
                right -= 1
                # 跳过重复元素
                while left < right and nums[left] == nums[left - 1]:
                    left += 1
                while left < right and nums[right] == nums[right + 1]:
                    right -= 1
            elif total < 0:
                left += 1
            else:
                right -= 1

    return result
```

## 时空复杂度

| 算法 | 时间复杂度 | 空间复杂度 |
|------|-----------|-----------|
| 滑动窗口 | O(n) | O(k) |
| 双指针 | O(n) | O(1) |
| 二分查找 | O(log n) | O(1) |

```mermaid
xychart-beta
    title "滑动窗口 vs 暴力算法性能对比"
    x-axis ["暴力 O(n²)", "滑动窗口 O(n)"]
    y-axis "时间复杂度" 0 --> 100
    bar [80, 20]
```

滑动窗口可以将 O(n²) 优化到 O(n)。
""",
        "published": True,
        "pinned": False,
        "category": "学习笔记",
        "tags": ["Algorithm", "Python"],
        "cover_image": "https://placehold.co/800x400/f97316/ffffff?text=Algorithms",
        "views": 650,
        "likes": 26,
        "created_days_ago": 3,
    },
    {
        "title": "新兴技术展望：边缘计算与 WebAssembly",
        "slug": "edge-computing-and-webassembly",
        "excerpt": "探讨边缘计算和 WebAssembly 在 Web 应用中的应用前景，以及它们如何改变应用架构。",
        "content": """# 边缘计算与 WebAssembly

## 什么是边缘计算

边缘计算将计算资源部署到靠近用户的边缘节点，减少延迟，提高性能。

```mermaid
graph LR
    A[用户浏览器] --> B[CDN 边缘节点]
    B --> C{Whether local cache?}
    C -->|Hit| D[直接返回]
    C -->|Miss| E[回源请求]
    E --> F[中心服务器]
```

## WebAssembly 基础

### 用途

1. **性能密集型计算**：图像处理、视频编解码
2. **语言移植**：C/C++、Rust 代码运行在浏览器
3. **插件替代**：取代浏览器插件

### Rust → WASM 示例

```rust
// src/lib.rs
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn fibonacci(n: u32) -> u32 {
    match n {
        0 => 0,
        1 => 1,
        _ => fibonacci(n - 1) + fibonacci(n - 2),
    }
}
```

```javascript
// 前端调用
import init, { fibonacci } from "./pkg/fibonacci.js"

await init()
const result = fibonacci(40)  // 比 JS 快 10-100 倍
```

## Cloudflare Workers

### 部署 WASM

```ts
// worker.ts
import { fibonacci } from "./fibonacci_bg.wasm"

export default {
  async fetch(request: Request) {
    const url = new URL(request.url)
    const n = parseInt(url.searchParams.get("n") || "40")

    return new Response(JSON.stringify({ result: fibonacci(n) }))
  },
}
```

### 性能对比

```mermaid
xychart-beta
    title "服务端计算性能对比"
    x-axis ["Node.js", "Cloudflare Worker", "WASM Native"]
    y-axis "执行时间 (ms)" 0 --> 100
    bar [80, 25, 5]
```

## 前端使用 WASM

### 图像处理

```javascript
// 使用 wasm 处理图片
import { process_image } from "./image_processor_bg.wasm"

function processImage(imageData) {
  const { data, width, height } = imageData
  const result = process_image(data, width, height)
  return new ImageData(new Uint8ClampedArray(result), width, height)
}
```

## 成本优化

### 定价对比

| 服务 | 价格 | 延迟 |
|------|------|------|
| EC2 t3.micro | $8.40/月 | 10-50ms |
| Cloudflare Worker | $0.50/月 | 1-5ms |
| 本地 WASM | 免费 | 0.1ms |

```mermaid
flowchart LR
    A[浏览器] --> B[WASM 模块]
    B --> C{需要网络?}
    C -->|是| D[CDN 缓存]
    C -->|否| E[本地运行]
    D --> F[边缘函数]
```

## 未来趋势

### WASI (WebAssembly System Interface)

```bash
# 在服务器上运行 WASM
wasmtime run example.wasm

# Docker 支持
docker run --runtime=wasmer example.wasm
```

### Component Model

```bash
# 跨语言组件
wit-bindgen rust --world my-world
```

WebAssembly 和边缘计算将带来更快、更安全、更分布式的 Web 应用。
""",
        "published": True,
        "pinned": False,
        "category": "技术分享",
        "tags": ["WebAssembly", "Architecture"],
        "cover_image": "https://placehold.co/800x400/06b6d4/ffffff?text=WebAssembly",
        "views": 360,
        "likes": 13,
        "created_days_ago": 30,
    },
    {
        "title": "Python 类型注解进阶：Pydantic V2 实战",
        "slug": "python-type-annotations-pydantic-v2",
        "excerpt": "掌握 Python 类型注解的高级用法，从 Pydantic V2 模型验证到复杂数据结构建模。",
        "content": r"""# Python 类型注解进阶

## Pydantic V2

### 基础模型

```python
from pydantic import BaseModel, EmailStr, field_validator

class UserCreate(BaseModel):
    name: str
    email: EmailStr
    age: int
    tags: list[str] = []

    @field_validator("age")
    @classmethod
    def validate_age(cls, v):
        if v < 0 or v > 150:
            raise ValueError("age must be between 0 and 150")
        return v
```

### 复杂类型

```python
from typing import Literal
from pydantic import BaseModel

class Post(BaseModel):
    title: str
    status: Literal["draft", "published", "archived"]
    tags: set[str]
    metadata: dict[str, str | int | bool]
```

### 嵌套模型

```python
class Author(BaseModel):
    name: str
    email: EmailStr

class Post(BaseModel):
    title: str
    author: Author
    coauthors: list[Author] = []
```

## 类型别名

### TypeAlias

```python
from typing import TypeAlias

UserID: TypeAlias = str
UserDict: TypeAlias = dict[str, str]
```

### 泛型

```python
from typing import TypeVar, Generic

T = TypeVar("T")

class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    limit: int
```

## 运行时验证

### Annotated

```python
from typing import Annotated
from pydantic import Field

class User(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=50)]
    age: Annotated[int, Field(ge=0, le=150)]
    email: Annotated[EmailStr, Field(pattern=r"^[^@]+@[^@]+\.[^@]+$")]
```

### 自定义验证

```python
from pydantic import BaseModel, field_validator

class Address(BaseModel):
    street: str
    city: str
    zip_code: str

    @field_validator("zip_code")
    @classmethod
    def validate_zip(cls, v: str) -> str:
        if not v.isdigit() or len(v) != 6:
            raise ValueError("zip_code must be 6 digits")
        return v
```

## 序列化

### 自定义序列化

```python
from pydantic import BaseModel, field_serializer
from datetime import datetime

class Event(BaseModel):
    name: str
    timestamp: datetime

    @field_serializer("timestamp")
    def serialize_timestamp(self, value: datetime) -> str:
        return value.isoformat()
```

### 排除字段

```python
class User(BaseModel):
    id: int
    name: str
    password: str

    model_config = {
        "json_schema_extra": {
            "exclude": ["password"]
        }
    }
```

```mermaid
flowchart LR
    A[Pydantic V2] --> B[类型验证]
    B --> C[数据清洗]
    C --> D[序列化]
    D --> E[JSON 输出]
```

Pydantic V2 比 V1 快 2-5 倍，同时提供更强大的类型验证功能。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Python", "FastAPI", "TypeScript"],
        "cover_image": "https://placehold.co/800x400/8b5cf6/ffffff?text=Python+V2",
        "views": 510,
        "likes": 19,
        "created_days_ago": 4,
    },
    {
        "title": "Redis 实战：缓存穿透防御术",
        "slug": "redis-cache-penetration-defense",
        "excerpt": "掌握 Redis 缓存穿透的防御策略，包括布隆过滤器、空值缓存和熔断机制。",
        "content": """# Redis 缓存穿透防御

## 什么是缓存穿透

缓存穿透发生在查询的数据在数据库和缓存中都不存在时，每次请求都会直接到达数据库，造成数据库压力过大。

```mermaid
flowchart LR
    A[用户请求] --> B[缓存查询]
    B --> C{是否存在?}
    C -->|否| D[数据库查询]
    D --> E{是否存在?}
    E -->|否| F[压力过大]
    E -->|是| G[写入缓存]
```

## 防御策略

### 1. 布隆过滤器

```python
from pybloom_live import BloomFilter

# 初始化布隆过滤器
bloom = BloomFilter(capacity=1000000, error_rate=0.01)

# 写入已存在的数据
for user_id in db.execute("SELECT id FROM users"):
    bloom.add(user_id)

def get_user(user_id: int) -> User | None:
    # 第一道防线
    if user_id not in bloom:
        return None  # 布隆过滤器判断不存在

    # 第二道防线
    cached = redis.get(f"user:{user_id}")
    if cached:
        return json.loads(cached)

    # 第三道防线
    user = db.get_user(user_id)
    if user:
        redis.setex(f"user:{user_id}", 3600, json.dumps(user))
    else:
        # 缓存穿透：记录不存在的数据
        redis.setex(f"user:{user_id}:null", 60, "not_found")

    return user
```

### 2. 空值缓存

```python
def get_post(post_id: int) -> Post | None:
    cached = redis.get(f"post:{post_id}")

    if cached == "null":
        return None  # 快速返回

    if cached:
        return Post(**json.loads(cached))

    post = db.get_post(post_id)

    if post:
        redis.setex(f"post:{post_id}", 3600, json.dumps(post.to_dict()))
    else:
        # 缓存不存在的数据，设置较短过期时间
        redis.setex(f"post:{post_id}", 60, "null")

    return post
```

### 3. 熔断器

```python
import time
from enum import Enum

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout=60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failure_count = 0
        self.last_failure_time = None
        self.state = CircuitState.CLOSED

    def call(self, func, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.timeout:
                self.state = CircuitState.HALF_OPEN
            else:
                raise Exception("Circuit breaker is OPEN")

        try:
            result = func(*args, **kwargs)
            self.on_success()
            return result
        except Exception:
            self.on_failure()
            raise

    def on_success(self):
        self.failure_count = 0
        self.state = CircuitState.CLOSED

    def on_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
```

## 性能监控

```python
from prometheus_client import Counter, Gauge

CACHE_HIT = Counter("cache_hit", "Cache hits")
CACHE_MISS = Counter("cache_miss", "Cache misses")
CACHE_PENETRATION = Counter("cache_penetration", "Cache penetration attempts")

def get_data(key: str):
    cached = redis.get(key)
    if cached:
        CACHE_HIT.inc()
        return cached
    else:
        CACHE_MISS.inc()
        # 检查是否是缓存穿透
        if redis.get(f"{key}:null"):
            CACHE_PENETRATION.inc()
        return None
```

```mermaid
flowchart LR
    A[布隆过滤器] --> B[缓存查询]
    B --> C{命中?}
    C -->|Hit| D[返回结果]
    C -->|Miss| E[空值缓存]
    E --> F[数据库查询]
    F --> G{存在?}
    G -->|是| H[写入缓存]
    G -->|否| I[写入空值缓存]
```

多层防御可以将缓存穿透率降低 99%+。
""",
        "published": True,
        "pinned": False,
        "category": "后端开发",
        "tags": ["Redis", "Database", "Cache"],
        "cover_image": "https://placehold.co/800x400/06b6d4/ffffff?text=Redis+Cache",
        "views": 420,
        "likes": 16,
        "created_days_ago": 8,
    },
]


def upgrade_schema() -> None:
    """Reconcile the schema via alembic migrations (the authoritative path).

    Replaces the old ``Base.metadata.create_all`` so dev seeding and CI (which
    runs this script on Postgres in the e2e job) exercise the same migration
    chain the production Docker entrypoint uses. (RIL TASK-009)
    """
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    print("✓ Schema up-to-date (alembic upgrade head)")


def main():
    upgrade_schema()
    db = SessionLocal()

    try:
        # Check if admin already exists
        existing_admin = db.query(auth.User).filter(auth.User.username == "admin").first()
        if existing_admin:
            print("✓ Admin user already exists")
        else:
            admin_password = os.getenv("ADMIN_PASSWORD")
            if not admin_password:
                if not is_development():
                    raise RuntimeError(
                        "ADMIN_PASSWORD is not set. Refusing to create an admin account "
                        "with a publicly known default password outside development. "
                        "Set ADMIN_PASSWORD, or set APP_ENV=development to use the dev default."
                    )
                admin_password = DEV_ADMIN_PASSWORD
                warnings.warn(
                    f"ADMIN_PASSWORD not set. Using the DEVELOPMENT-only default '{DEV_ADMIN_PASSWORD}'.",
                    stacklevel=2,
                )
            admin = auth.User(
                username="admin",
                password=auth.get_password_hash(admin_password),
                # role is the authoritative admin discriminator (DEC-054); the
                # role column's server_default would otherwise stamp "editor",
                # leaving is_superuser=True but every superuser-only endpoint
                # (users/export/batch/notify) 403ing for the seeded admin.
                role=auth.ROLE_SUPERUSER,
                is_superuser=True,
            )
            db.add(admin)
            if is_development():
                print(f"✓ Admin user created (admin/{admin_password})")
            else:
                print("✓ Admin user created")

        categories = ["前端开发", "后端开发", "技术分享", "学习笔记"]
        for name in categories:
            existing = db.query(models.Category).filter(models.Category.name == name).first()
            if not existing:
                db.add(models.Category(name=name))
        db.flush()
        print("✓ Categories created")

        all_tags = ["React", "Next.js", "Python", "FastAPI", "TypeScript", "JavaScript", "CSS", "数据库", "Vue", "Nuxt"]
        for name in all_tags:
            existing = db.query(models.Tag).filter(models.Tag.name == name).first()
            if not existing:
                db.add(models.Tag(name=name))
        db.flush()
        print("✓ Tags created")

        category_map = {c.name: c.id for c in db.query(models.Category).all()}
        tag_map = {t.name: t.id for t in db.query(models.Tag).all()}

        existing_posts = db.query(models.Post).count()
        if existing_posts > len(DEMO_POSTS):
            print(f"✓ {existing_posts} posts already exist, skipping seed")
        else:
            now = datetime.now(UTC)
            for post_data in DEMO_POSTS:
                slug = post_data["slug"]
                existing = db.query(models.Post).filter(models.Post.slug == slug).first()
                if existing:
                    continue

                created_at = now - timedelta(days=post_data.get("created_days_ago", 0))

                publish_at = None
                if "publish_at_days_from_now" in post_data:
                    publish_at = now + timedelta(days=post_data["publish_at_days_from_now"])

                post = models.Post(
                    title=post_data["title"],
                    slug=slug,
                    content=post_data["content"],
                    excerpt=post_data["excerpt"],
                    published=post_data["published"],
                    pinned=post_data.get("pinned", False),
                    publish_at=publish_at,
                    category_id=category_map.get(post_data["category"]),
                    cover_image=post_data.get("cover_image"),
                    views=post_data.get("views", 0),
                    likes=post_data.get("likes", 0),
                    created_at=created_at,
                    updated_at=created_at,
                )
                db.add(post)
                db.flush()

                for tag_name in post_data.get("tags", []):
                    if tag_name in tag_map:
                        tag = db.query(models.Tag).filter(models.Tag.id == tag_map[tag_name]).first()
                        if tag:
                            post.tags.append(tag)

                print(f"  ✓ Post created: {post_data['title'][:40]}")

            db.commit()
            print(f"✓ {len(DEMO_POSTS)} demo posts created")

        existing_comments = db.query(models.Comment).count()
        if existing_comments == 0:
            sample_comments = [
                {
                    "nickname": "张三",
                    "email": "zhangsan@example.com",
                    "content": "写得很棒！特别是关于 FastAPI 依赖注入的部分，让我受益匪浅。",
                    "is_approved": True,
                },
                {
                    "nickname": "李四",
                    "email": "lisi@example.com",
                    "content": "请问有没有关于性能测试的对比数据？想了解更多实际场景下的表现。",
                    "is_approved": True,
                },
                {
                    "nickname": "王五",
                    "email": "wangwu@example.com",
                    "content": "建议可以补充一些实际项目中的应用案例。",
                    "is_approved": False,
                },
                {
                    "nickname": "赵六",
                    "email": "zhaoliu@example.com",
                    "content": "这篇文章写得太好了，已收藏！期待更多类似内容。",
                    "is_approved": True,
                },
                {
                    "nickname": "spam_bot",
                    "email": "spam@spam.com",
                    "content": "点击这里领取免费比特币！！！http://spam-link.example.com",
                    "is_approved": False,
                },
            ]
            welcome_post = db.query(models.Post).filter(models.Post.slug == "welcome-to-x-blog").first()
            python_post = db.query(models.Post).filter(models.Post.slug == "python-3-14-new-features").first()
            ts_post = db.query(models.Post).filter(models.Post.slug == "typescript-5-practical-tips").first()

            for comment_data in sample_comments:
                if comment_data["nickname"] == "张三":
                    post_id = welcome_post.id if welcome_post else 1
                elif comment_data["nickname"] == "李四":
                    post_id = python_post.id if python_post else 1
                elif comment_data["nickname"] in ("王五", "spam_bot"):
                    post_id = welcome_post.id if welcome_post else 1
                else:
                    post_id = ts_post.id if ts_post else 1

                comment = models.Comment(
                    post_id=post_id,
                    nickname=comment_data["nickname"],
                    email=comment_data["email"],
                    content=comment_data["content"],
                    is_approved=comment_data["is_approved"],
                    ip_address="127.0.0.1",
                )
                db.add(comment)

            db.commit()
            print("✓ 5 sample comments created")

        # Post series (DEC-056/TASK-123): seed one series and group two of the
        # demo posts into it so the public /series pages and the admin series
        # management flow have real data to exercise in dev + e2e. Idempotent:
        # skips if the series already exists.
        if is_development():
            existing_series = db.query(models.Series).filter(models.Series.slug == "fastapi-tour").first()
            if existing_series:
                print("✓ Demo series already exists, skipping")
            else:
                demo_series = models.Series(
                    title="FastAPI 深入浅出",
                    slug="fastapi-tour",
                    description="从零开始系统地学习 FastAPI：框架基础、依赖注入、数据库实践与部署技巧。",
                )
                db.add(demo_series)
                db.flush()
                di_post = (
                    db.query(models.Post).filter(models.Post.slug == "fastapi-dependency-injection-deep-dive").first()
                )
                sql_post = db.query(models.Post).filter(models.Post.slug == "postgresql-performance-tuning").first()
                if di_post:
                    di_post.series_id = demo_series.id
                    di_post.series_order = 0
                if sql_post:
                    sql_post.series_id = demo_series.id
                    sql_post.series_order = 1
                db.commit()
                print("✓ Demo series created: FastAPI 深入浅出")

        total_posts = db.query(models.Post).count()
        total_comments = db.query(models.Comment).count()
        print("\n✨ Database initialized successfully!")
        print(f"   Posts: {total_posts}")
        print(f"   Comments: {total_comments}")
        print(f"   Categories: {len(categories)}")
        print(f"   Tags: {len(all_tags)}")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
