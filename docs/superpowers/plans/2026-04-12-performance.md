# X-Blog 性能优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化 X-Blog 性能（图片、缓存、代码分割）

**Architecture:** 使用 Next.js 16 优化功能

**Tech Stack:** Next.js 16, React

---

## 文件结构

```text
frontend/
├── next.config.mjs       # 更新: 图片配置
├── components/
│   ├── Markdown.tsx     # 更新: 支持图片优化
│   └── CommentList.tsx  # 更新: 懒加载
├── app/
│   ├── layout.tsx      # 更新: 预加载
│   └── page.tsx        # 更新: 静态生成
```

---

### Task 1: 图片优化

**Files:**

- Modify: `frontend/next.config.mjs`
- Modify: `frontend/components/Markdown.tsx`

- [ ] **Step 1: 更新 next.config.mjs**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24, // 1 day
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: 更新 Markdown 组件支持图片**

```typescript
import { marked } from "marked";
import Image from "next/image";

export default function Markdown({ content }: { content: string }) {
  const html = marked(content);

  // 处理图片添加 next/image 支持
  const processedHtml = html.replace(
    /<img src="(.*?)" alt="(.*?)" \/>/g,
    `<div class="relative w-full h-64 my-4">
      <Image 
        src="$1" 
        alt="$2" 
        fill
        class="object-cover rounded-lg"
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      />
    </div>`
  );

  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: processedHtml }}
    />
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/next.config.mjs frontend/components/Markdown.tsx && git commit -m "perf: optimize images with next/image"
```

---

### Task 2: 缓存优化

**Files:**

- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: 更新首页支持静态生成**

```typescript
import { fetchPosts } from "@/lib/api";
import PostCard from "@/components/PostCard";

export const dynamic = "force-static";
export const revalidate = 60; // 每 60 秒重新验证

export default async function Home() {
  const posts = await fetchPosts();

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">最新文章</h1>
      <div className="grid gap-6">
        {posts.length === 0 ? (
          <p className="text-gray-500">暂无文章</p>
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/app/page.tsx && git commit -m "perf: add static generation with revalidation"
```

---

### Task 3: 代码分割和预加载

**Files:**

- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/posts/[slug]/page.tsx`

- [ ] **Step 1: 布局添加预加载**

在 layout.tsx 的 Link 组件添加 `prefetch={true}` (默认已开启，但确认一下)：

```typescript
// Link 组件默认 prefetch=true，保持即可
```

- [ ] **Step 2: 懒加载评论组件**

修改文章详情页，使用动态导入：

```typescript
import dynamic from "next/dynamic";

const CommentList = dynamic(() => import("@/components/CommentList"), {
  loading: () => <div>加载评论...</div>,
  ssr: false,
});

const CommentForm = dynamic(() => import("@/components/CommentForm"), {
  loading: () => <div>加载表单...</div>,
  ssr: false,
});
```

- [ ] **Step 3: 提交**

```bash
git add frontend/app/posts/\[slug\]/page.tsx && git commit -m "perf: lazy load comments with dynamic import"
```

---

## 验证

完成所有任务后：

1. 构建检查通过
2. Lighthouse 性能评分提升

```bash
cd frontend && pnpm build
```
