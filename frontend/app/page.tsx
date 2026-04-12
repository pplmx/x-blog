import { fetchPosts, fetchCategories, fetchTags, fetchPopularPosts } from '@/lib/api';
import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import Sidebar from '@/components/Sidebar';

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
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
            {categoryId || tagId ? '筛选结果' : '最新文章'}
          </h1>
          <p className="text-gray-500 mt-2">
            {categoryId || tagId ? '以下是符合筛选条件的文章' : '探索最新的技术文章和见解'}
          </p>
        </div>
        <div className="grid gap-6">
          {posts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">暂无文章</p>
              <p className="text-sm mt-1">换个筛选条件试试？</p>
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
