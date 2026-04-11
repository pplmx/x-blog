# 代码质量改进设计

**日期**: 2026-04-11  
**状态**: 已批准 (方案 A)

## 1. 目标

低投入高回报的代码质量改进：组件提取 + 类型修复

## 2. 方案 A: 快速优化

### 2.1 组件提取

**PostForm 组件** (`frontend/components/PostForm.tsx`):
- 提取自 `admin/posts/[id]/page.tsx`
- 包含：标题、slug、内容、摘要、分类、标签、封面图、发布状态
- 通用 Props: `initialData?`, `onSubmit`, `onCancel`

**CommentSection 组件** (`frontend/components/CommentSection.tsx`):
- 提取自 `posts/[slug]/page.tsx`
- 包含：评论列表 + 评论表单
- 通用 Props: `postId`

### 2.2 类型修复

- 添加关键类型注解
- 修复 any 类型
- 改进 Props 定义

## 3. 文件变更

```typescript
// 提取 (新建)
frontend/components/PostForm.tsx
frontend/components/CommentSection.tsx

// 修改
frontend/app/admin/posts/[id]/page.tsx  - 使用 PostForm
frontend/app/posts/[slug]/page.tsx       - 使用 CommentSection
```

## 4. 验收标准

- [ ] PostForm 组件提取
- [ ] CommentSection 组件提取
- [ ] 文章编辑页面使用 PostForm
- [ ] 文章详情页使用 CommentSection
- [ ] Lint 通过
- [ ] 测试通过