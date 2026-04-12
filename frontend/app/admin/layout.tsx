'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Tag,
  Folder,
  LogOut,
  Menu,
  X,
  ArrowLeft,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useEffect, useState } from 'react';

const navItems = [
  { href: '/admin', icon: LayoutDashboard, label: '仪表盘' },
  { href: '/admin/posts', icon: FileText, label: '文章' },
  { href: '/admin/comments', icon: MessageCircle, label: '评论' },
  { href: '/admin/categories', icon: Folder, label: '分类' },
  { href: '/admin/tags', icon: Tag, label: '标签' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/admin/login');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <button
          className="fixed inset-0 bg-black/50 z-40 lg:hidden cursor-default"
          onClick={() => setSidebarOpen(false)}
          aria-label="关闭菜单"
        />
      )}

      {/* 侧边栏 */}
      <aside
        className={`
        fixed lg:static inset-y-0 left-0 z-50 w-64 border-r bg-card p-4 transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}
      >
        <div className="flex items-center justify-between mb-6 px-2">
          <Link
            href="/admin"
            className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent"
          >
            X-Blog 管理
          </Link>
          <button className="lg:hidden p-1" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)}>
              <Button variant="ghost" className="w-full justify-start">
                <item.icon className="mr-2 h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          ))}
        </nav>

        <div className="mt-6 pt-6 border-t space-y-2">
          <Link href="/" onClick={() => setSidebarOpen(false)}>
            <Button variant="outline" className="w-full">
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回前台
            </Button>
          </Link>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              logout();
              router.push('/admin/login');
            }}
          >
            <LogOut className="mr-2 h-4 w-4" />
            退出登录
          </Button>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* 移动端顶部栏 */}
        <header className="lg:hidden border-b bg-card p-4 flex items-center">
          <button className="p-2 -ml-2 mr-2" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-bold">X-Blog 管理</span>
        </header>

        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
