# Aurora 博客前端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 Next.js 14 前端，展示博客文章列表和详情

**Architecture:** Next.js 14 App Router + TypeScript + Tailwind CSS

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, marked (Markdown 渲染)

---

## 文件结构

```
frontend/
├── app/
│   ├── layout.tsx          # 根布局
│   ├── page.tsx            # 首页 - 文章列表
│   ├── posts/
│   │   └── [slug]/
│   │       └── page.tsx    # 文章详情页
│   ├── about/
│   │   └── page.tsx        # 关于页面
│   └── globals.css         # 全局样式
├── components/
│   ├── Header.tsx          # 头部导航
│   ├── Footer.tsx          # 页脚
│   ├── PostCard.tsx        # 文章卡片
│   └── Markdown.tsx        # Markdown 渲染
├── lib/
│   └── api.ts              # API 客户端
├── types/
│   └── index.ts            # TypeScript 类型
├── tailwind.config.ts      # Tailwind 配置
├── next.config.ts          # Next.js 配置
└── package.json
```

---

### Task 1: 项目初始化

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/next.config.ts`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/postcss.config.mjs`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "aurora-frontend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "marked": "^12.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
cd frontend
npm install
```

- [ ] **Step 3: 创建配置文件**

```typescript
// frontend/tsconfig.json
{
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

```typescript
// frontend/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

```typescript
// frontend/tailwind.config.ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
export default config;
```

```javascript
// frontend/postcss.config.mjs
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: 验证项目运行**

```bash
cd frontend
npm run dev
# 访问 http://localhost:3000 应能看到空白页面
```

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: init Next.js frontend project"
```

---

### Task 2: 类型定义和 API 客户端

**Files:**
- Create: `frontend/types/index.ts`
- Create: `frontend/lib/api.ts`

- [ ] **Step 1: 创建类型定义**

```typescript
// frontend/types/index.ts
export interface Category {
  id: number;
  name: string;
}

export interface Tag {
  id: number;
  name: string;
}

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
  category_id: number | null;
  category: Category | null;
  tags: Tag[];
}

export interface PostList {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  published: boolean;
  created_at: string;
  category: Category | null;
  tags: Tag[];
}
```

- [ ] **Step 2: 创建 API 客户端**

```typescript
// frontend/lib/api.ts
const API_BASE = "/api";

export async function fetchPosts(): Promise<PostList[]> {
  const res = await fetch(`${API_BASE}/posts`);
  if (!res.ok) throw new Error("Failed to fetch posts");
  return res.json();
}

export async function fetchPost(slug: string): Promise<Post> {
  const res = await fetch(`${API_BASE}/posts/${slug}`);
  if (!res.ok) throw new Error("Failed to fetch post");
  return res.json();
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat: add types and API client"
```

---

### Task 3: 公共组件

**Files:**
- Create: `frontend/components/Header.tsx`
- Create: `frontend/components/Footer.tsx`

- [ ] **Step 1: 创建 Header 组件**

```typescript
// frontend/components/Header.tsx
import Link from "next/link";

export default function Header() {
  return (
    <header className="border-b">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/" className="text-2xl font-bold">
          Aurora
        </Link>
        <nav className="flex gap-6">
          <Link href="/" className="hover:text-blue-600">
            首页
          </Link>
          <Link href="/about" className="hover:text-blue-600">
            关于
          </Link>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: 创建 Footer 组件**

```typescript
// frontend/components/Footer.tsx
export default function Footer() {
  return (
    <footer className="border-t mt-12">
      <div className="container mx-auto px-4 py-6 text-center text-gray-600">
        <p>© {new Date().getFullYear()} Aurora Blog. All rights reserved.</p>
      </div>
    </footer>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat: add Header and Footer components"
```

---

### Task 4: Markdown 渲染组件

**Files:**
- Create: `frontend/components/Markdown.tsx`

- [ ] **Step 1: 创建 Markdown 组件**

```typescript
// frontend/components/Markdown.tsx
import { marked } from "marked";

interface MarkdownProps {
  content: string;
}

export default function Markdown({ content }: MarkdownProps) {
  const html = marked(content);
  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/
git commit -m "feat: add Markdown renderer component"
```

---

### Task 5: 首页 - 文章列表

**Files:**
- Create: `frontend/app/globals.css`
- Create: `frontend/app/layout.tsx`
- Create: `frontend/components/PostCard.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: 创建全局样式**

```css
/* frontend/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-white text-gray-900;
}
```

- [ ] **Step 2: 创建根布局**

```typescript
// frontend/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Aurora Blog",
  description: "A simple blog built with Next.js and FastAPI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <body>
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 container mx-auto px-4 py-8">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: 创建 PostCard 组件**

```typescript
// frontend/components/PostCard.tsx
import Link from "next/link";
import { PostList } from "@/types";

interface PostCardProps {
  post: PostList;
}

export default function PostCard({ post }: PostCardProps) {
  const date = new Date(post.created_at).toLocaleDateString("zh-CN");
  
  return (
    <article className="border rounded-lg p-6 hover:shadow-lg transition">
      <Link href={`/posts/${post.slug}`}>
        <h2 className="text-xl font-semibold mb-2 hover:text-blue-600">
          {post.title}
        </h2>
      </Link>
      <div className="text-sm text-gray-500 mb-3">
        <span>{date}</span>
        {post.category && (
          <span className="ml-4 px-2 py-1 bg-gray-100 rounded text-xs">
            {post.category.name}
          </span>
        )}
      </div>
      {post.excerpt && (
        <p className="text-gray-600 mb-4 line-clamp-2">{post.excerpt}</p>
      )}
      <div className="flex gap-2">
        {post.tags.map((tag) => (
          <span
            key={tag.id}
            className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded"
          >
            {tag.name}
          </span>
        ))}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: 创建首页**

```typescript
// frontend/app/page.tsx
import { fetchPosts } from "@/lib/api";
import PostCard from "@/components/PostCard";

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

- [ ] **Step 5: 测试首页**

```bash
cd frontend
npm run dev
# 访问 http://localhost:3000 应能看到文章列表
```

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: add home page with post list"
```

---

### Task 6: 文章详情页

**Files:**
- Create: `frontend/app/posts/[slug]/page.tsx`

- [ ] **Step 1: 创建文章详情页**

```typescript
// frontend/app/posts/[slug]/page.tsx
import { fetchPost } from "@/lib/api";
import Markdown from "@/components/Markdown";
import Link from "next/link";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;
  
  let post;
  try {
    post = await fetchPost(slug);
  } catch {
    notFound();
  }

  const date = new Date(post.created_at).toLocaleDateString("zh-CN");

  return (
    <article>
      <Link href="/" className="text-blue-600 hover:underline mb-6 inline-block">
        ← 返回首页
      </Link>
      
      <header className="mb-8">
        <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
        <div className="text-gray-500">
          <span>{date}</span>
          {post.category && (
            <span className="ml-4 px-2 py-1 bg-gray-100 rounded text-sm">
              {post.category.name}
            </span>
          )}
        </div>
        <div className="flex gap-2 mt-4">
          {post.tags.map((tag) => (
            <span
              key={tag.id}
              className="text-sm px-3 py-1 bg-blue-50 text-blue-600 rounded"
            >
              {tag.name}
            </span>
          ))}
        </div>
      </header>
      
      <Markdown content={post.content} />
    </article>
  );
}
```

- [ ] **Step 2: 测试文章详情页**

```bash
# 假设后端有一篇 slug 为 "hello" 的文章
# 访问 http://localhost:3000/posts/hello 应能看到文章详情
```

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat: add post detail page"
```

---

### Task 7: 关于页面

**Files:**
- Create: `frontend/app/about/page.tsx`

- [ ] **Step 1: 创建关于页面**

```typescript
// frontend/app/about/page.tsx
import Link from "next/link";

export default function AboutPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">关于 Aurora</h1>
      <div className="prose">
        <p>
          Aurora 是一个简单的博客系统，使用 FastAPI + Next.js 构建。
        </p>
        <p>
          后端采用 FastAPI + SQLAlchemy，提供 RESTful API。
          前端采用 Next.js 14 App Router，支持服务端渲染。
        </p>
        <p>
          <Link href="/" className="text-blue-600 hover:underline">
            返回首页
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/
git commit -m "feat: add about page"
```

---

## 验证

完成所有任务后，验证：
1. 首页 http://localhost:3000 显示文章列表
2. 文章详情页正常工作
3. 关于页面可访问
4. 前后端 API 通信正常

```bash
# 确保后端运行在 http://localhost:8000
# 前端运行在 http://localhost:3000
# 通过 Next.js 代理访问后端 API
```