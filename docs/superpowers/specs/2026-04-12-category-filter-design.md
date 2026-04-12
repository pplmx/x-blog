# X-Blog 标签/分类筛选设计

**日期**: 2026-04-12  
**状态**: 已批准

## 1. 功能

- 首页文章列表支持按分类/标签筛选
- 侧边栏显示分类和标签，点击筛选
- 顶部添加筛选下拉菜单
- URL 参数同步（如 `?category=tech`）

## 2. API 设计

### 现有端点扩展

| Method | Endpoint   | 参数                             |
| ------ | ---------- | -------------------------------- |
| GET    | /api/posts | category_id, tag_id, page, limit |

### 示例

```text
/api/posts                     # 全部文章
/api/posts?category_id=1       # 分类 ID=1 的文章
/api/posts?tag_id=2            # 标签 ID=2 的文章
/api/posts?category_id=1&tag_id=2  # 组合筛选
```

## 3. 前端

### 侧边栏

- 显示所有分类和标签
- 点击后更新文章列表
- 高亮当前选中的分类/标签

### 顶部筛选

- 下拉菜单选择分类/标签
- 支持清除筛选

### 路由

- 筛选状态通过 URL 参数同步
- 支持刷新后保持筛选状态

## 4. 实现

### 后端

- 修改 `crud.py` 的 `get_posts` 函数，支持 `category_id` 和 `tag_id` 参数
- 修改 `routers/posts.py`，解析查询参数

### 前端

- 创建 `components/Sidebar.tsx` - 侧边栏组件
- 更新 `app/page.tsx` - 添加筛选逻辑和 UI
- 创建 `components/FilterBar.tsx` - 顶部筛选组件
