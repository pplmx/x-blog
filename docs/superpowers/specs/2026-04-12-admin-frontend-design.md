# X-Blog 管理后台设计

**日期**: 2026-04-12  
**状态**: 已批准

## 1. 架构

- **后端**: 现有 REST API（无需修改）
- **前端**: Next.js 16 + shadcn/ui 管理页面

## 2. 页面

| 路由                | 功能       |
| ------------------- | ---------- |
| `/admin`            | 仪表盘首页 |
| `/admin/posts`      | 文章 CRUD  |
| `/admin/categories` | 分类 CRUD  |
| `/admin/tags`       | 标签 CRUD  |

## 3. 技术栈

- **Next.js 16** - App Router
- **shadcn/ui** - UI 组件库
- **React Hook Form** - 表单管理
- **Zod** - 表单验证
- **TanStack Table** - 表格组件

## 4. API（复用现有）

| Method | Endpoint        | 功能     |
| ------ | --------------- | -------- |
| GET    | /api/posts      | 文章列表 |
| POST   | /api/posts      | 创建文章 |
| GET    | /api/posts/{id} | 文章详情 |
| PUT    | /api/posts/{id} | 更新文章 |
| DELETE | /api/posts/{id} | 删除文章 |
| GET    | /api/categories | 分类列表 |
| POST   | /api/categories | 创建分类 |
| GET    | /api/tags       | 标签列表 |
| POST   | /api/tags       | 创建标签 |

## 5. MVP 范围

- 无用户认证
- 纯前端管理界面
- 基础 CRUD 功能
