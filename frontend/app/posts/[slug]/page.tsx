import { fetchPost } from '@/lib/api';
import Markdown from '@/components/Markdown';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Tag } from '@/types';
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import ViewTracker from '@/components/ViewTracker';
import { Calendar, Folder, Tag as TagIcon, Eye, ArrowLeft, Share2, Clock } from 'lucide-react';

const CommentList = dynamic(() => import('@/components/CommentList'), {
  loading: () => <div className="animate-pulse h-32 bg-gray-50 rounded-xl" />,
});

const CommentForm = dynamic(() => import('@/components/CommentForm'), {
  loading: () => <div className="animate-pulse h-24 bg-gray-50 rounded-xl" />,
});

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  let post;
  try {
    post = await fetchPost(slug);
  } catch {
    return {};
  }

  return {
    title: post.title,
    description: post.excerpt || post.content.slice(0, 150),
    openGraph: {
      title: post.title,
      description: post.excerpt || post.content.slice(0, 150),
      type: 'article',
      publishedTime: post.created_at,
      authors: ['X-Blog'],
      tags: post.tags.map((t: Tag) => t.name),
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt || post.content.slice(0, 150),
    },
  };
}

export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;

  let post;
  try {
    post = await fetchPost(slug);
  } catch {
    notFound();
  }

  const date = new Date(post.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const readTime = Math.max(1, Math.ceil(post.content.length / 500));

  return (
    <>
      <ViewTracker postId={post.id} />

      <article className="max-w-3xl mx-auto">
        {/* 返回按钮 */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          返回首页
        </Link>

        {/* 文章头部 */}
        <header className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4 leading-tight">
            {post.title}
          </h1>

          {/* 元信息 */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" />
              {date}
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {readTime} 分钟阅读
            </span>
            <span className="flex items-center gap-1.5">
              <Eye className="w-4 h-4" />
              {post.views || 0} 次阅读
            </span>
          </div>

          {/* 分类和标签 */}
          <div className="flex flex-wrap items-center gap-3 mt-4">
            {post.category && (
              <Link
                href={`/?category_id=${post.category.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-50 to-indigo-50 text-purple-700 rounded-full text-sm font-medium hover:from-purple-100 hover:to-indigo-100 transition-colors"
              >
                <Folder className="w-3.5 h-3.5" />
                {post.category.name}
              </Link>
            )}
            {post.tags.map((tag: Tag) => (
              <Link
                key={tag.id}
                href={`/?tag_id=${tag.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 rounded-full text-sm font-medium hover:from-blue-100 hover:to-indigo-100 transition-colors"
              >
                <TagIcon className="w-3.5 h-3.5" />#{tag.name}
              </Link>
            ))}
          </div>
        </header>

        {/* 分割线 */}
        <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent mb-8" />

        {/* 文章内容 */}
        <div className="prose prose-lg max-w-none mb-12">
          <Markdown content={post.content} />
        </div>

        {/* 分割线 */}
        <div className="h-px bg-gradient-to-r from-transparent via-gray-200 to-transparent mb-8" />

        {/* 评论区 */}
        <section className="mb-12">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Share2 className="w-5 h-5 text-blue-600" />
            评论
          </h2>
          <CommentList postId={post.id} />
          <div className="mt-6">
            <CommentForm postId={post.id} />
          </div>
        </section>

        {/* SEO Schema */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BlogPosting',
              headline: post.title,
              description: post.excerpt || post.content.slice(0, 150),
              datePublished: post.created_at,
              author: {
                '@type': 'Person',
                name: 'X-Blog',
              },
            }),
          }}
        />
      </article>
    </>
  );
}
