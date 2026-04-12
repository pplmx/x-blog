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
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-lg shadow-blue-600/20 mb-6">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-3">
          关于 X-Blog
        </h1>
        <p className="text-gray-500">一个现代化的技术博客系统</p>
      </div>

      {/* 介绍 */}
      <div className="bg-card border rounded-2xl p-6 sm:p-8 mb-8">
        <p className="text-gray-600 leading-relaxed mb-4">
          X-Blog
          是一个简洁优雅的技术博客系统，采用现代前端与后端技术构建。我们致力于为开发者提供一个轻量、快速、且美观的博客平台。
        </p>
        <p className="text-gray-600 leading-relaxed">
          无论是分享技术心得、记录学习笔记，还是发布项目动态，X-Blog
          都能为你提供出色的写作与阅读体验。
        </p>
      </div>

      {/* 技术栈 */}
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-blue-600" />
          技术栈
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {techStack.map((tech) => (
            <div
              key={tech.name}
              className="bg-card border rounded-xl p-4 text-center hover:border-gray-300 transition-colors"
            >
              <div
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br ${tech.color} mb-3`}
              >
                <tech.icon className="w-5 h-5 text-white" />
              </div>
              <p className="font-medium text-gray-900">{tech.name}</p>
              <p className="text-xs text-gray-500">{tech.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 功能列表 */}
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4">核心功能</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {features.map((feature) => (
            <div
              key={feature}
              className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg px-4 py-2.5 text-sm text-blue-700 font-medium text-center"
            >
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* 页脚 */}
      <div className="text-center pt-8 border-t">
        <p className="text-gray-500 text-sm flex items-center justify-center gap-1.5">
          Made with <Heart className="w-4 h-4 text-red-500" /> for developers
        </p>
      </div>
    </div>
  );
}
