import Link from 'next/link';
import SearchBox from './SearchBox';
import { Home, User } from 'lucide-react';

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent hover:from-blue-700 hover:to-indigo-700 transition-all">
          X-Blog
        </Link>
        <div className="flex items-center gap-6">
          <SearchBox />
          <nav className="flex gap-5">
            <Link href="/" className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors">
              <Home className="w-4 h-4" />
              <span>首页</span>
            </Link>
            <Link href="/about" className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600 transition-colors">
              <User className="w-4 h-4" />
              <span>关于</span>
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
