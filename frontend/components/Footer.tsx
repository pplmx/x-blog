import Link from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="border-t border-gray-100 mt-12 bg-gradient-to-b from-white to-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              X-Blog
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-500 text-sm">
              © {currentYear} All rights reserved.
            </span>
          </div>
          
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <Link href="/rss.xml" className="hover:text-orange-500 transition-colors">
              RSS 订阅
            </Link>
            <Link href="/sitemap.xml" className="hover:text-blue-600 transition-colors">
              网站地图
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
