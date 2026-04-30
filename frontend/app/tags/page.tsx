import { fetchTags, fetchPosts } from '@/lib/api';
import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import { Tag, ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';

export const dynamic = 'force-static';
export const revalidate = 60;

interface TagsPageProps {
  searchParams: Promise<{ tag_id?: string; page?: string }>;
}

export async function generateMetadata({ searchParams }: TagsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const tagId = params.tag_id;

  if (tagId) {
    return {
      title: '标签文章',
      robots: { noindex: true },
    };
  }

  return {
    title: '所有标签',
    description: '浏览 X-Blog 的所有标签',
  };
}

export default async function TagsPage({ searchParams }: TagsPageProps) {
  const params = await searchParams;
  const tagId = params.tag_id ? parseInt(params.tag_id) : undefined;
  const page = params.page ? parseInt(params.page) : 1;

  const tags = await fetchTags();

  // 如果没有选择标签，显示所有标签
  if (!tagId) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mb-2">
            所有标签
          </h1>
          <p className="text-gray-500 dark:text-gray-400">共 {tags.length} 个标签</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {tags.map((tag) => (
            <a
              key={tag.id}
              href={`/tags?tag_id=${tag.id}`}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl text-sm font-medium hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md shadow-blue-500/20 hover:shadow-lg"
            >
              #{tag.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  // 显示该标签下的文章
  const currentTag = tags.find((t) => t.id === tagId);
  const { items: posts, pagination } = await fetchPosts({ tag_id: tagId, page, limit: 10 });

  return (
    <div>
      <div className="mb-8">
        <a
          href="/tags"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          返回所有标签
        </a>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent mt-2 mb-1">
          标签: #{currentTag?.name || tagId}
        </h1>
        <p className="text-gray-500 dark:text-gray-400">共 {pagination.total} 篇文章</p>
      </div>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <Tag className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">暂无文章</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">该标签下还没有文章</p>
        </div>
      ) : (
        <>
          <div className="grid gap-6">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
          <Pagination
            currentPage={page}
            totalPages={pagination.total_pages}
            baseUrl={`/tags?tag_id=${tagId}`}
          />
        </>
      )}
    </div>
  );
}
