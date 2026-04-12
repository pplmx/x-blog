# 代码质量改进实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 低投入高回报的代码质量改进

**Architecture:** 提取通用组件，减少重复代码，添加类型注解

**Tech Stack:** React, TypeScript

---

## Task 1: PostForm 组件提取

**Files:**

- Create: `frontend/components/PostForm.tsx`
- Modify: `frontend/app/admin/posts/[id]/page.tsx`

- [ ] **Step 1: 创建 PostForm 组件**

从 `admin/posts/[id]/page.tsx` 提取表单逻辑为通用组件:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUpload } from '@/components/ImageUpload';
import { 
  fetchAdminCategories, 
  fetchAdminTags, 
  createAdminPost, 
  updateAdminPost 
} from '@/lib/api';
import type { PostCreate } from '@/types';

interface PostFormProps {
  postId?: number | null;
  initialData?: Partial<PostCreate>;
  onSuccess?: () => void;
}

export function PostForm({ postId, initialData, onSuccess }: PostFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<Partial<PostCreate>>({
    title: '',
    slug: '',
    content: '',
    excerpt: '',
    published: false,
    category_id: undefined,
    tag_ids: [],
    cover_image: undefined,
  });

  // ... rest of the form logic
}
```

- [ ] **Step 2: 修改 admin/posts/[id]/page.tsx 使用 PostForm**

- [ ] **Step 3: 运行 lint**

Run: `cd /var/tmp/aurora && pnpm lint`

- [ ] **Step 4: Commit**

```bash
git add frontend/components/PostForm.tsx
git commit -m "refactor: extract PostForm component"
```

## Task 2: CommentSection 组件提取

**Files:**

- Create: `frontend/components/CommentSection.tsx`
- Modify: `frontend/app/posts/[slug]/page.tsx`

- [ ] **Step 1: 创建 CommentSection 组件**

从 `posts/[slug]/page.tsx` 提取评论区域:

```typescript
interface CommentSectionProps {
  postId: number;
}

export function CommentSection({ postId }: CommentSectionProps) {
  // Extract comment list + form logic
}
```

- [ ] **Step 2: 修改 posts/[slug]/page.tsx 使用 CommentSection**

- [ ] **Step 3: 运行 lint**

- [ ] **Step 4: Commit**

```bash
git add frontend/components/CommentSection.tsx
git commit -m "refactor: extract CommentSection component"
```

## Task 3: 类型注解修复

**Files:**

- Modify: 关键文件的类型定义

- [ ] **Step 1: 检查并修复 any 类型**

Run: `cd /var/tmp/aurora/frontend && pnpm tsc --noEmit 2>&1 | head -20`

- [ ] **Step 2: 添加缺失的类型注解**

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "types: add missing type annotations"
```

## Task 4: 最终验证

- [ ] **Step 1: 运行测试**

Run: `cd /var/tmp/aurora && pnpm test`

- [ ] **Step 2: 运行 lint**

Run: `cd /var/tmp/aurora && pnpm lint`

---

## 验收

- [ ] PostForm 组件提取
- [ ] CommentSection 组件提取
- [ ] 文章编辑页面使用 PostForm
- [ ] 文章详情页使用 CommentSection
- [ ] Lint 通过
- [ ] 测试通过

---

**Plan complete. Two execution options:**

**1. Subagent-Driven (recommended)**  
**2. Inline Execution**

Which approach?
