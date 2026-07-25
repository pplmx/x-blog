import { fetchPost } from '@/lib/api';
import Markdown, { extractToc, TocItem } from '@/components/Markdown';
import TableOfContents from '@/components/TableOfContents';
import LikeButton from '@/components/LikeButton';
import RelatedPosts from '@/components/RelatedPosts';
import ReadingProgress from '@/components/ReadingProgress';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Tag } from '@/types';
import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import ViewTracker from '@/components/ViewTracker';
import { Calendar, Folder, Tag as TagIcon, Eye, ArrowLeft, Share2, Clock } from 'lucide-react';
import {
  calculateReadingTime,
  formatReadingTime,
  countWords,
  formatWordCount,
} from '@/lib/reading-time';
import { Type } from 'lucide-react';
import ShareButtons from '@/components/ShareButtons';

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
      images: post.cover_image ? [{ url: post.cover_image, width: 1200, height: 630 }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt || post.content.slice(0, 150),
      images: post.cover_image ? [post.cover_image] : [],
    },
  };
}

function PostContent({ post }: { post: Awaited<ReturnType<typeof fetchPost>> }) {
  const date = new Date(post.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const readTime = calculateReadingTime(post.content);
  const readTimeText = formatReadingTime(readTime);
  const wordCount = countWords(post.content);
  const wordCountText = formatWordCount(wordCount);
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

          {/* 封面图 */}
          {post.cover_image && (
            <div className="relative w-full h-[300px] sm:h-[400px] rounded-2xl overflow-hidden mb-8 shadow-xl">
              <Image
                src={post.cover_image}
                alt={post.title}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 800px"
              />
            </div>
          )}

          {/* 文章头部 */}
          <header className="mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-6 leading-tight">
              {post.title}
            </h1>

            {/* 元信息卡片 */}
            <div className="bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl p-5 mb-6 border border-gray-100 dark:border-gray-800">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
                <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-blue-500" />
                  </div>
                  {date}
                </span>
                <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-green-500" />
                  </div>
                  {readTimeText}
                </span>
                <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
                    <Type className="w-4 h-4 text-purple-500" />
                  </div>
                  {wordCountText}
                </span>
                <span className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-900/30 flex items-center justify-center">
                    <Eye className="w-4 h-4 text-orange-500" />
                  </div>
                  {post.views || 0} 次阅读
                </span>
                <LikeButton postId={post.id} initialLikes={post.likes || 0} />
              </div>
            </div>

            {/* 分类和标签 */}
            <div className="flex flex-wrap items-center gap-3">
              {post.category && (
                <Link
                  href={`/?category_id=${post.category.id}`}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-xl text-sm font-medium hover:from-purple-600 hover:to-indigo-600 transition-all shadow-md shadow-purple-500/25"
                >
                  <Folder className="w-4 h-4" />
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

          {/* 分享按钮 */}
          <ShareButtons title={post.title} />

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
            wordCount: wordCount.total,
            timeRequired: `PT${readTime}M`,
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
