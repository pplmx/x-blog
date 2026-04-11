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
                  <span className={`px-2 py-1 rounded text-xs ${post.published ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
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