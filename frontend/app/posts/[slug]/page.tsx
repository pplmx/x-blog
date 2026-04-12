import { fetchPost } from '@/lib/api';
import Markdown, { extractToc, TocItem } from '@/components/Markdown';
import TableOfContents from '@/components/TableOfContents';
import LikeButton from '@/components/LikeButton';
import RelatedPosts from '@/components/RelatedPosts';
import ReadingProgress from '@/components/ReadingProgress';
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

function PostContent({ post }: { post: Awaited<ReturnType<typeof fetchPost>> }) {
  const date = new Date(post.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const readTime = Math.max(1, Math.ceil(post.content.length / 500));
  const toc: TocItem[] = extractToc(post.content);

  return (
    <>
      <ReadingProgress />
      <ViewTracker postId={post.id} />

      <div className="flex flex-col lg:flex-row gap-8">
        {/* 主内容区 */}
        <article className="flex-1 max-w-3xl">
          {/* 返回按钮 */}
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </Link>

          {/* 文章头部 */}
          <header className="mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4 leading-tight">
              {post.title}
            </h1>

            {/* 元信息 */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
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
              <LikeButton postId={post.id} initialLikes={post.likes || 0} />
            </div>

            {/* 分类和标签 */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              {post.category && (
                <Link
                  href={`/?category_id=${post.category.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-50 dark:from-purple-900/30 to-indigo-50 dark:to-indigo-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-medium hover:from-purple-100 dark:hover:from-purple-900/50 hover:to-indigo-100 dark:hover:to-indigo-900/50 transition-colors"
                >
                  <Folder className="w-3.5 h-3.5" />
                  {post.category.name}
                </Link>
              )}
              {post.tags.map((tag: Tag) => (
                <Link
                  key={tag.id}
                  href={`/?tag_id=${tag.id}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium hover:from-blue-100 dark:hover:from-blue-900/50 hover:to-indigo-100 dark:hover:to-indigo-900/50 transition-colors"
                >
                  <TagIcon className="w-3.5 h-3.5" />#{tag.name}
                </Link>
              ))}
            </div>
          </header>

          {/* 分割线 */}
          <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent mb-8" />

          {/* 文章内容 */}
          <div className="prose prose-lg dark:prose-invert max-w-none mb-12">
            <Markdown content={post.content} />
          </div>

          {/* 分割线 */}
          <div className="h-px bg-gradient-to-r from-transparent via-gray-200 dark:via-gray-700 to-transparent mb-8" />

          {/* 相关文章 */}
          <RelatedPosts postId={post.id} />

          {/* 评论区 */}
          <section className="mb-12">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2 dark:text-gray-100">
              <Share2 className="w-5 h-5 text-blue-600" />
              评论
            </h2>
            <CommentList postId={post.id} />
            <div className="mt-6">
              <CommentForm postId={post.id} />
            </div>
          </section>
        </article>

        {/* TOC 侧边栏 - 仅桌面端 */}
        {toc.length > 0 && (
          <aside className="hidden lg:block w-56 shrink-0">
            <TableOfContents toc={toc} />
          </aside>
        )}
      </div>

      {/* SEO Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.excerpt || post.content.slice(0, 150),
            image: post.cover_image || undefined,
            datePublished: post.created_at,
            dateModified: post.updated_at,
            author: {
              '@type': 'Person',
              name: 'X-Blog',
            },
            publisher: {
              '@type': 'Organization',
              name: 'X-Blog',
              logo: {
                '@type': 'ImageObject',
                url: '/logo.png',
              },
            },
            mainEntityOfPage: {
              '@type': 'WebPage',
              '@id': `/posts/${post.slug}`,
            },
            articleSection: post.category?.name || 'Blog',
            keywords: post.tags.map((t: Tag) => t.name).join(', '),
            wordCount: post.content.length,
            interactionStatistic: [
              {
                '@type': 'InteractionCounter',
                interactionType: 'https://schema.org/CommentAction',
                userInteractionCount: 0, // 可后续接入评论数
              },
            ],
          }),
        }}
      />
      
      {/* Breadcrumb Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: '首页',
                item: '/',
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: post.category?.name || '文章',
                item: post.category ? `/?category_id=${post.category.id}` : '/posts',
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: post.title,
                item: `/posts/${post.slug}`,
              },
            ],
          }),
        }}
      />
    </>
  );
}

export default async function PostPage({ params }: PageProps) {
  const { slug } = await params;

  let post;
  try {
    post = await fetchPost(slug);
  } catch {
    notFound();
  }

  return <PostContent post={post} />;
}
