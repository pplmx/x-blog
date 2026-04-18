import { fetchPosts, fetchCategories, fetchTags, fetchPopularPosts } from '@/lib/api';
import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import Sidebar from '@/components/Sidebar';

export const revalidate = 60;

export default async function HomeEN({
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

  let baseUrl = '/en';
  if (categoryId) baseUrl = `/en?category_id=${categoryId}`;
  else if (tagId) baseUrl = `/en?tag_id=${tagId}`;

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      <div className="flex-1">
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
            {categoryId || tagId ? 'Filtered Results' : 'Latest Posts'}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">
            {categoryId || tagId
              ? 'Articles matching your filters'
              : 'Explore the latest tech articles and insights'}
          </p>
        </div>
        <div className="grid gap-6">
          {posts.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <p className="text-lg">No posts yet</p>
              <p className="text-sm mt-1">Try a different filter</p>
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
      {/* Sidebar: desktop only */}
      <div className="hidden lg:block w-64 shrink-0">
        <Sidebar categories={categories} tags={tags} popularPosts={popularPosts} />
      </div>
    </div>
  );
}
