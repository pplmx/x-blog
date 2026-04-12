# X-Blog 分页设计

**日期**: 2026-04-12  
**状态**: 已批准

## 1. 功能

- 首页文章列表支持分页
- 支持筛选 + 分页组合
- URL 参数同步（如 `?page=2`）

## 2. API 设计

### 现有端点扩展

| Method | Endpoint   | 参数        |
| ------ | ---------- | ----------- |
| GET    | /api/posts | page, limit |

### 示例

```text
/api/posts?page=1&limit=10   # 第1页，每页10篇
/api/posts?page=2&limit=10   # 第2页，每页10篇
/api/posts?page=1&limit=5    # 第1页，每页5篇
```

## 3. 响应扩展

API 需要返回总数：

```json
{
  "items": [...],
  "total": 50,
  "page": 1,
  "limit": 10,
  "total_pages": 5
}
```

## 4. 前端

### 组件

- `Pagination.tsx` - 分页组件

### URL 同步

- 页码通过 URL 参数同步
- 支持刷新后保持分页状态

## 5. 实现

### 后端

- 修改 schemas 返回总数
- 路由添加分页参数

### 前端

- 创建分页组件
- 更新首页集成
