import { Suspense } from 'react';
import { fetchPosts, fetchCategories, fetchTags, fetchPopularPosts } from '@/lib/api';
import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import Sidebar from '@/components/Sidebar';
import MobileFilterBar from '@/components/MobileFilterBar';
import Loading from './loading';

export const revalidate = 60;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category_id?: string; tag_id?: string; page?: string }>;
}) {
  const params = await searchParams;
  const categoryId = params.category_id ? parseInt(params.category_id) : undefined;
  const tagId = params.tag_id ? parseInt(params.tag_id) : undefined;
  const page = params.page ? parseInt(params.page) : 1;

  const [{ items: posts, pagination }, categories, tags, popularPosts] = await Promise.all([
    fetchPosts({ category_id: categoryId, tag_id: tagId, page, limit: 10 }),
    fetchCategories(),
    fetchTags(),
    fetchPopularPosts(5),
  ]);

  let baseUrl = '/';
  if (categoryId) baseUrl = `/?category_id=${categoryId}`;
  else if (tagId) baseUrl = `/?tag_id=${tagId}`;

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <div className="flex-1">
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
            {categoryId || tagId ? '筛选结果' : '最新文章'}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {categoryId || tagId ? '以下是符合筛选条件的文章' : '探索最新的技术文章和见解'}
          </p>
        </div>

        {/* 移动端筛选栏 */}
        <Suspense fallback={null}>
          <MobileFilterBar categories={categories} tags={tags} />
        </Suspense>
        <div className="grid gap-6">
          {posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-24 h-24 mb-6 rounded-full bg-gradient-to-br from-gray-50 dark:from-gray-800 to-gray-100 dark:to-gray-700 flex items-center justify-center">
                <svg aria-label="暂无文章" className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">暂无文章</h3>
              <p className="text-gray-500 dark:text-gray-400 text-center max-w-sm">
                {categoryId || tagId ? '当前筛选条件下没有文章，试试其他分类或标签吧' : '这里还没有文章，敬请期待'}
              </p>
              {(categoryId || tagId) && (
                <Link
                  href="/"
                  className="mt-6 px-6 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl font-medium hover:from-blue-600 hover:to-indigo-600 transition-all shadow-md shadow-blue-500/25"
                >
                  查看全部文章
                </Link>
              )}
            </div>
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} />)
          )}
        </div>
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.total_pages}
          baseUrl={baseUrl}
        />
      </div>
      {/* 侧边栏：桌面端显示，移动端隐藏 */}
      <div className="hidden lg:block w-64 shrink-0">
        <Sidebar categories={categories} tags={tags} popularPosts={popularPosts} />
      </div>
    </div>
  );
}
