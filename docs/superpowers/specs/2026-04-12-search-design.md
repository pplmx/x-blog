# X-Blog 搜索功能设计

> **Created:** 2026-04-12

## Goal

实现博客搜索功能，支持实时搜索建议和独立搜索结果页面。

## Scope

- 搜索范围：文章、分类、标签
- 搜索方式：实时搜索 + 独立搜索页面
- 结果排序：标题匹配 > 发布时间

---

## UI/UX

### 1. 搜索框（导航栏）

- 位置：Header 右侧
- 交互：输入时显示下拉建议（最多 5 条）
- 建议分类显示：文章、分类、标签
- 点击建议或按回车跳转到搜索结果页

### 2. 搜索结果页 `/search`

- URL：`/search?q=关键词`
- 显示：所有匹配的文章（分页）
- 无结果时显示友好提示
- 支持分页

---

## Backend API

### 搜索接口

```text
GET /api/search?q={query}&type={post|category|tag}&page=1&limit=10
```

**响应：**

```json
{
  "items": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "total_pages": 10
  }
}
```

### 实现

- 在后端添加 `search` 路由
- 使用 SQLAlchemy `or_` 实现多字段模糊搜索
- 搜索权重：标题匹配 > 内容匹配 > 分类/标签匹配

---

## Frontend

### 文件结构

```text
frontend/
├── app/
│   └── search/
│       └── page.tsx       # 搜索结果页
├── components/
│   ├── SearchBox.tsx      # 搜索框组件（含实时建议）
│   └── SearchResults.tsx  # 搜索结果列表
└── lib/
    └── api.ts             # 添加 search 函数
```

### SearchBox 组件

- 输入框：受控组件
- 实时建议：防抖 300ms 后请求
- 下拉框：显示匹配的文章/分类/标签
- 键盘导航：上下键选择，回车确认

### 搜索结果页

- 静态生成（ISR 60s）
- 显示结果数量
- 分页组件

---

## Data Flow

```text
用户输入 → SearchBox → 防抖 → API 请求 → 显示建议
                                     ↓
用户点击 → 跳转 /search?q=xxx → 搜索结果页 → 分页
```

---

## Acceptance Criteria

1. 搜索框输入时实时显示建议（延迟 300ms）
2. 建议包含文章、分类、标签三类
3. 点击建议或回车跳转到搜索结果页
4. 搜索结果页显示匹配文章，分页正常
5. 无结果时显示友好提示
6. 搜索结果按标题匹配 > 发布时间排序

---

## Testing

- 后端：搜索 API 单元测试
- 前端：SearchBox 组件测试、搜索结果页测试

---

## Files

**Backend:**

- `backend/app/routers/search.py` - 新增
- `backend/app/main.py` - 注册路由
- `backend/app/crud.py` - 添加 search_posts 函数

**Frontend:**

- `frontend/components/SearchBox.tsx` - 新增
- `frontend/components/SearchResults.tsx` - 新增
- `frontend/app/search/page.tsx` - 新增
- `frontend/lib/api.ts` - 添加 search 函数
