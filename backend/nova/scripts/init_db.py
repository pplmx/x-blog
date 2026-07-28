#!/usr/bin/env python
"""Initialize database with sample data and demo posts."""

import sys
from datetime import UTC, datetime, timedelta

sys.path.insert(0, ".")
from app import auth, models
from app.database import SessionLocal

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

欢迎使用 X-Blog！你可以通过管理后台 `admin` / `admin123` 登录进行管理。
""",
        "published": True,
        "pinned": True,
        "category": "技术分享",
        "tags": ["FastAPI", "Nuxt", "TypeScript", "Vue"],
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
        "published": False,
        "pinned": False,
        "category": "技术分享",
        "tags": ["Python", "FastAPI"],
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
        "views": 0,
        "likes": 0,
        "created_days_ago": 0,
    },
]


def main():
    db = SessionLocal()

    try:
        existing_admin = db.query(auth.User).filter(auth.User.username == "admin").first()
        if existing_admin:
            print("✓ Admin user already exists")
        else:
            admin = auth.User(
                username="admin",
                password=auth.get_password_hash("admin123"),
                is_superuser=True,
            )
            db.add(admin)
            print("✓ Admin user created (admin/admin123)")

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
            for i, post_data in enumerate(DEMO_POSTS):
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
                    cover_image=f"https://placehold.co/800x400/3b82f6/ffffff?text={post_data['title'][:20]}",
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
                {"nickname": "张三", "email": "zhangsan@example.com", "content": "写得很棒！特别是关于 FastAPI 依赖注入的部分，让我受益匪浅。", "is_approved": True},
                {"nickname": "李四", "email": "lisi@example.com", "content": "请问有没有关于性能测试的对比数据？想了解更多实际场景下的表现。", "is_approved": True},
                {"nickname": "王五", "email": "wangwu@example.com", "content": "建议可以补充一些实际项目中的应用案例。", "is_approved": False},
                {"nickname": "赵六", "email": "zhaoliu@example.com", "content": "这篇文章写得太好了，已收藏！期待更多类似内容。", "is_approved": True},
                {"nickname": "spam_bot", "email": "spam@spam.com", "content": "点击这里领取免费比特币！！！http://spam-link.example.com", "is_approved": False},
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

        total_posts = db.query(models.Post).count()
        total_comments = db.query(models.Comment).count()
        print(f"\n✨ Database initialized successfully!")
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
