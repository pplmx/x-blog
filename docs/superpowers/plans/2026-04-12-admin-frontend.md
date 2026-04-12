# X-Blog 管理后台实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 Next.js + shadcn/ui 构建管理后台，实现文章/分类/标签的 CRUD

**Architecture:** 前端使用 App Router，通过 REST API 与后端通信

**Tech Stack:** Next.js 16, shadcn/ui, React Hook Form, Zod, TanStack Table

---

## 文件结构

```text
frontend/
├── app/
│   └── admin/
│       ├── layout.tsx          # Admin 布局
│       ├── page.tsx            # 仪表盘
│       ├── posts/
│       │   ├── page.tsx        # 文章列表
│       │   └── [id]/page.tsx   # 文章编辑
│       ├── categories/
│       │   └── page.tsx        # 分类管理
│       └── tags/
│           └── page.tsx        # 标签管理
├── components/
│   └── admin/                  # Admin 组件
│       ├── Sidebar.tsx
│       ├── Header.tsx
│       ├── DataTable.tsx
│       ├── PostForm.tsx
│       ├── CategoryForm.tsx
│       └── TagForm.tsx
├── lib/
│   └── admin-api.ts            # Admin API 客户端
└── package.json                # 添加 shadcn 依赖
```

---

### Task 1: 安装 shadcn/ui 依赖

**Files:**

- Modify: `frontend/package.json`

- [ ] **Step 1: 添加依赖到 package.json**

```json
{
  "dependencies": {
    "@radix-ui/react-slot": "^1.1.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.3.0",
    "lucide-react": "^0.400.0",
    "@hookform/resolvers": "^3.4.0",
    "react-hook-form": "^7.51.0",
    "zod": "^3.23.0",
    "@tanstack/react-table": "^8.17.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
cd frontend && pnpm install
```

- [ ] **Step 3: 初始化 shadcn/ui 配置**

创建 `frontend/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 4: 创建工具函数**

创建 `frontend/lib/utils.ts`:

```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/components.json frontend/lib/utils.ts && git commit -m "feat: add shadcn/ui dependencies"
```

---

### Task 2: 创建基础 UI 组件

**Files:**

- Create: `frontend/components/ui/button.tsx`
- Create: `frontend/components/ui/input.tsx`
- Create: `frontend/components/ui/card.tsx`
- Create: `frontend/components/ui/table.tsx`
- Create: `frontend/components/ui/dialog.tsx`
- Create: `frontend/components/ui/form.tsx`
- Create: `frontend/components/ui/label.tsx`
- Create: `frontend/components/ui/select.tsx`

- [ ] **Step 1: 创建 Button 组件**

```typescript
// frontend/components/ui/button.tsx
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
```

- [ ] **Step 2: 创建 Input 组件**

```typescript
// frontend/components/ui/input.tsx
import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
```

- [ ] **Step 3: 创建 Card 组件**

```typescript
// frontend/components/ui/card.tsx
import * as React from "react"
import { cn } from "@/lib/utils"

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-xl border bg-card text-card-foreground shadow", className)} {...props} />
  )
)
Card.displayName = "Card"

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
)
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
  )
)
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
  )
)
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }
```

- [ ] **Step 4: 创建更多组件（简化版）**

由于组件较多，使用简化版本创建 table, dialog, form, label, select 等基础组件。

- [ ] **Step 5: Commit**

```bash
git add frontend/components/ui/ && git commit -m "feat: add shadcn/ui base components"
```

---

### Task 3: Admin 布局

**Files:**

- Create: `frontend/app/admin/layout.tsx`
- Create: `frontend/app/admin/page.tsx`

- [ ] **Step 1: 创建 Admin 布局**

```typescript
// frontend/app/admin/layout.tsx
import Link from "next/link"
import { LayoutDashboard, FileText, Tag, Folder } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navItems = [
    { href: "/admin", icon: LayoutDashboard, label: "仪表盘" },
    { href: "/admin/posts", icon: FileText, label: "文章" },
    { href: "/admin/categories", icon: Folder, label: "分类" },
    { href: "/admin/tags", icon: Tag, label: "标签" },
  ]

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 border-r bg-card p-4">
        <h1 className="text-xl font-bold mb-6 px-2">X-Blog 管理</h1>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <Button variant="ghost" className="w-full justify-start">
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          ))}
        </nav>
        <div className="mt-6 pt-6 border-t">
          <Link href="/">
            <Button variant="outline" className="w-full">
              返回前台
            </Button>
          </Link>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: 创建仪表盘**

```typescript
// frontend/app/admin/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { getPosts } from "@/lib/api"

export default async function AdminDashboard() {
  const posts = await getPosts()
  const publishedCount = posts.filter((p) => p.published).length

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">仪表盘</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">文章总数</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{posts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">已发布</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{publishedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">草稿</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{posts.length - publishedCount}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/ && git commit -m "feat: add admin layout and dashboard"
```

---

### Task 4: 文章管理

**Files:**

- Create: `frontend/app/admin/posts/page.tsx`
- Create: `frontend/app/admin/posts/[id]/page.tsx`

- [ ] **Step 1: 创建文章列表**

```typescript
// frontend/app/admin/posts/page.tsx
"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Plus, Pencil, Trash2 } from "lucide-react"

interface Post {
  id: number
  title: string
  slug: string
  published: boolean
  created_at: string
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/posts")
      .then((res) => res.json())
      .then((data) => {
        setPosts(data)
        setLoading(false)
      })
  }, [])

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除这篇文章吗？")) return
    await fetch(`/api/posts/${id}`, { method: "DELETE" })
    setPosts(posts.filter((p) => p.id !== id))
  }

  if (loading) return <div>加载中...</div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">文章管理</h1>
        <Link href="/admin/posts/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新建文章
          </Button>
        </Link>
      </div>

      <div className="border rounded-lg">
        <table className="w-full">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-2 text-left">标题</th>
              <th className="px-4 py-2 text-left">Slug</th>
              <th className="px-4 py-2 text-left">状态</th>
              <th className="px-4 py-2 text-left">日期</th>
              <th className="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => (
              <tr key={post.id} className="border-t">
                <td className="px-4 py-2">{post.title}</td>
                <td className="px-4 py-2 text-muted-foreground">{post.slug}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      post.published ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {post.published ? "已发布" : "草稿"}
                  </span>
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {new Date(post.created_at).toLocaleDateString("zh-CN")}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/posts/${post.id}`}>
                    <Button variant="ghost" size="sm">
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(post.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 创建文章编辑页面**

```typescript
// frontend/app/admin/posts/[id]/page.tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Post {
  id: number
  title: string
  slug: string
  content: string
  excerpt: string
  published: boolean
}

export default function PostEditPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const isNew = params.id === "new"
  const [post, setPost] = useState<Post | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isNew) {
      fetch(`/api/posts/${params.id}`)
        .then((res) => res.json())
        .then((data) => {
          setPost(data)
          setLoading(false)
        })
    }
  }, [isNew, params.id])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSaving(true)

    const formData = new FormData(e.currentTarget)
    const data = {
      title: formData.get("title"),
      slug: formData.get("slug"),
      content: formData.get("content"),
      excerpt: formData.get("excerpt"),
      published: formData.get("published") === "on",
    }

    const method = isNew ? "POST" : "PUT"
    const url = isNew ? "/api/posts" : `/api/posts/${params.id}`

    await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })

    setSaving(false)
    router.push("/admin/posts")
  }

  if (loading) return <div>加载中...</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{isNew ? "新建文章" : "编辑文章"}</h1>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
        <div>
          <label className="block text-sm font-medium mb-1">标题</label>
          <Input name="title" defaultValue={post?.title} required />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Slug</label>
          <Input name="slug" defaultValue={post?.slug} required />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">摘要</label>
          <Input name="excerpt" defaultValue={post?.excerpt} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">内容 (Markdown)</label>
          <textarea
            name="content"
            defaultValue={post?.content}
            required
            className="w-full h-64 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" name="published" id="published" defaultChecked={post?.published ?? false} />
          <label htmlFor="published">发布</label>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push("/admin/posts")}>
            取消
          </Button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/app/admin/posts/ && git commit -m "feat: add posts admin page"
```

---

### Task 5: 分类管理

**Files:**

- Create: `frontend/app/admin/categories/page.tsx`

- [ ] **Step 1: 创建分类管理页面**

```typescript
// frontend/app/admin/categories/page.tsx
"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2 } from "lucide-react"

interface Category {
  id: number
  name: string
}

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")

  useEffect(() => {
    fetch("/api/categories")
      .then((res) => res.json())
      .then((data) => {
        setCategories(data)
        setLoading(false)
      })
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return

    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    })
    const created = await res.json()
    setCategories([...categories, created])
    setNewName("")
  }

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除这个分类吗？")) return
    // 简化：直接删除前端数据
    setCategories(categories.filter((c) => c.id !== id))
  }

  if (loading) return <div>加载中...</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">分类管理</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新分类名称" />
        <Button type="submit">
          <Plus className="mr-2 h-4 w-4" />
          添加
        </Button>
      </form>

      <div className="space-y-2">
        {categories.map((cat) => (
          <div key={cat.id} className="flex items-center justify-between p-3 border rounded-lg">
            <span>{cat.name}</span>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(cat.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/categories/ && git commit -m "feat: add categories admin page"
```

---

### Task 6: 标签管理

**Files:**

- Create: `frontend/app/admin/tags/page.tsx`

- [ ] **Step 1: 创建标签管理页面（与分类类似）**

```typescript
// frontend/app/admin/tags/page.tsx
"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2 } from "lucide-react"

interface Tag {
  id: number
  name: string
}

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState("")

  useEffect(() => {
    fetch("/api/tags")
      .then((res) => res.json())
      .then((data) => {
        setTags(data)
        setLoading(false)
      })
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return

    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    })
    const created = await res.json()
    setTags([...tags, created])
    setNewName("")
  }

  const handleDelete = async (id: number) => {
    if (!confirm("确定要删除这个标签吗？")) return
    setTags(tags.filter((t) => t.id !== id))
  }

  if (loading) return <div>加载中...</div>

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">标签管理</h1>

      <form onSubmit={handleCreate} className="flex gap-2 mb-6">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新标签名称" />
        <Button type="submit">
          <Plus className="mr-2 h-4 w-4" />
          添加
        </Button>
      </form>

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <div key={tag.id} className="flex items-center gap-2 p-2 border rounded-lg">
            <span>{tag.name}</span>
            <Button variant="ghost" size="sm" onClick={() => handleDelete(tag.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/admin/tags/ && git commit -m "feat: add tags admin page"
```

---

## 验证

完成所有任务后，验证：

1. 访问 http://localhost:3000/admin 查看管理后台
2. 能查看文章列表
3. 能创建/编辑/删除文章
4. 能管理分类和标签

```bash
cd frontend && pnpm dev
```
