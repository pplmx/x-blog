'use client';

import { useState } from 'react';
import Link from 'next/link';
import SearchBox from './SearchBox';
import ThemeToggle from './ThemeToggle';
import { Home, User, Menu, X } from 'lucide-react';

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link
          href="/"
          className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent hover:from-blue-700 hover:to-indigo-700 transition-all"
        >
          X-Blog
        </Link>

        {/* 桌面端导航 */}
        <div className="hidden md:flex items-center gap-4">
          <SearchBox />
          <ThemeToggle />
          <nav aria-label="主导航">
            <ul className="flex gap-5 list-none m-0 p-0">
              <li>
                <Link
                  href="/"
                  className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors"
                >
                  <Home className="w-4 h-4" aria-hidden="true" />
                  <span>首页</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors"
                >
                  <User className="w-4 h-4" aria-hidden="true" />
                  <span>关于</span>
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        {/* 移动端菜单按钮 */}
        <button
          className="md:hidden p-2 text-gray-600"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-menu"
          aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
        >
          {mobileMenuOpen ? (
            <X className="w-6 h-6" aria-hidden="true" />
          ) : (
            <Menu className="w-6 h-6" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* 移动端菜单 */}
      {mobileMenuOpen && (
        <div
          id="mobile-menu"
          className="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900"
        >
          <div className="px-4 py-3 flex items-center gap-3">
            <SearchBox />
            <ThemeToggle />
          </div>
          <nav aria-label="移动端导航">
            <ul className="flex flex-col px-4 pb-4 list-none m-0 p-0">
              <li>
                <Link
                  href="/"
                  className="flex items-center gap-2 py-2 text-gray-600 hover:text-blue-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Home className="w-5 h-5" aria-hidden="true" />
                  <span>首页</span>
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  className="flex items-center gap-2 py-2 text-gray-600 hover:text-blue-600"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <User className="w-5 h-5" aria-hidden="true" />
                  <span>关于</span>
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}
