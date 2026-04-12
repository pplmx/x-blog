'use client';

import { useState } from 'react';
import Link from 'next/link';
import SearchBox from './SearchBox';
import { Home, User, Menu, X } from 'lucide-react';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link
          href="/"
          className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent hover:from-blue-700 hover:to-indigo-700 transition-all"
        >
          X-Blog
        </Link>

        {/* 桌面端导航 */}
        <div className="hidden md:flex items-center gap-6">
          <SearchBox />
          <nav className="flex gap-5">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors"
            >
              <Home className="w-4 h-4" />
              <span>首页</span>
            </Link>
            <Link
              href="/about"
              className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors"
            >
              <User className="w-4 h-4" />
              <span>关于</span>
            </Link>
          </nav>
        </div>

        {/* 移动端菜单按钮 */}
        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* 移动端菜单 */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white">
          <div className="px-4 py-3">
            <SearchBox />
          </div>
          <nav className="flex flex-col px-4 pb-4">
            <Link
              href="/"
              className="flex items-center gap-2 py-2 text-gray-600 hover:text-blue-600"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Home className="w-5 h-5" />
              <span>首页</span>
            </Link>
            <Link
              href="/about"
              className="flex items-center gap-2 py-2 text-gray-600 hover:text-blue-600"
              onClick={() => setMobileMenuOpen(false)}
            >
              <User className="w-5 h-5" />
              <span>关于</span>
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
