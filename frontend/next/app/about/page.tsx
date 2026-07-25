import Link from 'next/link';
import type { Metadata } from 'next';
import { Code2, Database, Globe, Sparkles, ArrowLeft, Heart } from 'lucide-react';

export const metadata: Metadata = {
  title: '关于',
  description: '关于 X-Blog - 技术博客系统',
};

export default function AboutPage() {
  const techStack = [
    { icon: Globe, name: 'Next.js', desc: '前端框架', color: 'from-black to-gray-800' },
    { icon: Code2, name: 'FastAPI', desc: '后端框架', color: 'from-green-500 to-green-700' },
    { icon: Database, name: 'SQLAlchemy', desc: 'ORM', color: 'from-orange-500 to-red-500' },
    { icon: Sparkles, name: 'TypeScript', desc: '语言', color: 'from-blue-500 to-blue-700' },
  ];

  const features = [
    'Markdown 文章支持',
    '分类与标签管理',
    '评论系统',
    '阅读量统计',
    'RSS 订阅',
    'SEO 优化',
    '响应式设计',
    '管理后台',
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* 返回按钮 */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        返回首页
      </Link>

      {/* 头部 */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-3xl shadow-xl shadow-blue-600/25 mb-6">
          <Sparkles className="w-12 h-12 text-white" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-3">
          关于 X-Blog
        </h1>
        <p className="text-gray-500 dark:text-gray-400">一个现代化的技术博客系统</p>
      </div>

      {/* 介绍 */}
      <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl p-6 sm:p-8 mb-8 border border-gray-100 dark:border-gray-800">
        <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">
          X-Blog
          是一个简洁优雅的技术博客系统，采用现代前端与后端技术构建。我们致力于为开发者提供一个轻量、快速、且美观的博客平台。
        </p>
        <p className="text-gray-600 dark:text-gray-300 leading-relaxed">
          无论是分享技术心得、记录学习笔记，还是发布项目动态，X-Blog
          都能为你提供出色的写作与阅读体验。
        </p>
      </div>

      {/* 技术栈 */}
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900 dark:text-gray-100">
          <Code2 className="w-5 h-5 text-blue-600" />
          技术栈
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {techStack.map((tech) => (
            <div
              key={tech.name}
              className="bg-white dark:bg-gray-900 rounded-xl p-4 text-center border border-gray-100 dark:border-gray-800 hover:shadow-lg hover:border-gray-200 dark:hover:border-gray-700 transition-all duration-200"
            >
              <div
                className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${tech.color} mb-3 shadow-md`}
              >
                <tech.icon className="w-6 h-6 text-white" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{tech.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{tech.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 功能列表 */}
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">核心功能</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {features.map((feature) => (
            <div
              key={feature}
              className="bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 border border-blue-100 dark:border-blue-900/50 rounded-xl px-4 py-3 text-sm text-blue-700 dark:text-blue-300 font-medium text-center hover:shadow-md transition-shadow"
            >
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* 页脚 */}
      <div className="text-center pt-8 border-t border-gray-100 dark:border-gray-800">
        <p className="text-gray-500 dark:text-gray-400 text-sm flex items-center justify-center gap-2">
          Made with <Heart className="w-4 h-4 text-red-500 animate-pulse" /> for developers
        </p>
      </div>
    </div>
  );
}
