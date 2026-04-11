import Link from "next/link"
import { LayoutDashboard, FileText, Tag, Folder } from "lucide-react"
import { Button } from "@/components/ui/button"

const navItems = [
  { href: "/admin", icon: LayoutDashboard, label: "仪表盘" },
  { href: "/admin/posts", icon: FileText, label: "文章" },
  { href: "/admin/categories", icon: Folder, label: "分类" },
  { href: "/admin/tags", icon: Tag, label: "标签" },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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