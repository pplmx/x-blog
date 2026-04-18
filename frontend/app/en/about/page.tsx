import Link from 'next/link';
import type { Metadata } from 'next';
import { Code2, Database, Globe, Sparkles, ArrowLeft, Heart } from 'lucide-react';

export const metadata: Metadata = {
  title: 'About',
  description: 'About X-Blog - A Modern Tech Blog System',
  alternates: {
    canonical: '/en/about',
  },
};

export default function AboutPageEN() {
  const techStack = [
    { icon: Globe, name: 'Next.js', desc: 'Frontend Framework', color: 'from-black to-gray-800' },
    {
      icon: Code2,
      name: 'FastAPI',
      desc: 'Backend Framework',
      color: 'from-green-500 to-green-700',
    },
    { icon: Database, name: 'SQLAlchemy', desc: 'ORM', color: 'from-orange-500 to-red-500' },
    { icon: Sparkles, name: 'TypeScript', desc: 'Language', color: 'from-blue-500 to-blue-700' },
  ];

  const features = [
    'Markdown Support',
    'Categories & Tags',
    'Comment System',
    'View Statistics',
    'RSS Feed',
    'SEO Optimized',
    'Responsive Design',
    'Admin Dashboard',
  ];

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back button */}
      <Link
        href="/en"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Home
      </Link>

      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-lg shadow-blue-600/20 mb-6">
          <Sparkles className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-3">
          About X-Blog
        </h1>
        <p className="text-gray-500">A modern tech blog system</p>
      </div>

      {/* Introduction */}
      <div className="bg-card border rounded-2xl p-6 sm:p-8 mb-8">
        <p className="text-gray-600 leading-relaxed mb-4">
          X-Blog is a clean and elegant tech blog system built with modern frontend and backend
          technologies. We are dedicated to providing developers with a lightweight, fast, and
          beautiful blogging platform.
        </p>
        <p className="text-gray-600 leading-relaxed">
          Whether you want to share technical insights, document your learning journey, or publish
          project updates, X-Blog delivers an excellent writing and reading experience.
        </p>
      </div>

      {/* Tech Stack */}
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Code2 className="w-5 h-5 text-blue-600" />
          Tech Stack
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

      {/* Features */}
      <div className="mb-8">
        <h2 className="text-lg font-bold mb-4">Core Features</h2>
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

      {/* Footer */}
      <div className="text-center pt-8 border-t">
        <p className="text-gray-500 text-sm flex items-center justify-center gap-1.5">
          Made with <Heart className="w-4 h-4 text-red-500" /> for developers
        </p>
      </div>
    </div>
  );
}
