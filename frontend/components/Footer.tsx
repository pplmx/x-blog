import Link from 'next/link';
import { Rss, MapPin, Github, Twitter, Mail } from 'lucide-react';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-100 dark:border-gray-800 bg-gradient-to-b from-gray-50 dark:from-gray-900 to-white dark:to-gray-950">
      <div className="container mx-auto px-4 py-12">
        {/* 主要内容区 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* 关于 */}
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              <span className="text-2xl bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                X-Blog
              </span>
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              探索技术世界，分享编程心得、算法解读和项目实践经验。每一次代码都是成长的印记。
            </p>
          </div>

          {/* 快速链接 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 uppercase tracking-wider">
              快速链接
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/"
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  首页
                </Link>
              </li>
              <li>
                <Link
                  href="/tags"
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  标签
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  className="text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  关于
                </Link>
              </li>
            </ul>
          </div>

          {/* 订阅 */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4 uppercase tracking-wider">
              订阅更新
            </h4>
            <div className="flex items-center gap-3">
              <Link
                href="/rss.xml"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-orange-50 dark:bg-orange-900/30 text-orange-500 hover:bg-orange-100 dark:hover:bg-orange-900/50 hover:text-orange-600 transition-all"
                title="RSS 订阅"
              >
                <Rss className="w-5 h-5" />
              </Link>
              <Link
                href="/atom.xml"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-green-50 dark:bg-green-900/30 text-green-500 hover:bg-green-100 dark:hover:bg-green-900/50 hover:text-green-600 transition-all"
                title="Atom 订阅"
              >
                <svg aria-label="Atom订阅" className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                </svg>
              </Link>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 transition-all"
                title="GitHub"
              >
                <Github className="w-5 h-5" />
              </a>
            </div>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent mb-6" />

        {/* 底部栏 */}
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-400 dark:text-gray-500">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4" />
            <span>© {currentYear} X-Blog. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sitemap.xml" className="hover:text-blue-500 transition-colors">
              网站地图
            </Link>
            <span>·</span>
            <Link href="/privacy" className="hover:text-blue-500 transition-colors">
              隐私政策
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}