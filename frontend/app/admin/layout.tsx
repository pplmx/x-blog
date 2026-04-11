'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LayoutDashboard, FileText, Tag, Folder, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-context';
import { useEffect } from 'react';

const navItems = [
  { href: '/admin', icon: LayoutDashboard, label: '仪表盘' },
  { href: '/admin/posts', icon: FileText, label: '文章' },
  { href: '/admin/categories', icon: Folder, label: '分类' },
  { href: '/admin/tags', icon: Tag, label: '标签' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();

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
        <div className="mt-6 pt-6 border-t space-y-2">
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
          <Link href="/">
            <Button variant="outline" className="w-full">
              返回前台
            </Button>
          </Link>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
