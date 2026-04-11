# Aurora 博客项目设计

**日期**: 2026-04-11  
**状态**: 已批准

## 1. 技术栈

- **后端**: FastAPI + SQLAlchemy + SQLite
- **前端**: Next.js 14 (App Router) + TypeScript + Tailwind CSS

## 2. API 设计

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/posts | 文章列表（分页） |
| GET | /api/posts/{id} | 文章详情 |
| POST | /api/posts | 创建文章 |
| PUT | /api/posts/{id} | 更新文章 |
| DELETE | /api/posts/{id} | 删除文章 |
| GET | /api/categories | 分类列表 |
| GET | /api/tags | 标签列表 |

## 3. 数据模型

### Post
- id: int (PK)
- title: str
- slug: str
- content: str (Markdown)
- excerpt: str
- published: bool
- created_at: datetime
- updated_at: datetime
- category_id: int (FK)

### Category
- id: int (PK)
- name: str

### Tag
- id: int (PK)
- name: str

### PostTag (多对多关联表)
- post_id: int
- tag_id: int

## 4. 前端页面

| 页面 | 路由 |
|------|------|
| 首页 | / |
| 文章详情 | /posts/{slug} |
| 关于 | /about |

## 5. MVP 范围

- 纯阅读，无后台管理
- 本地数据库管理文章
- 简单分类/标签