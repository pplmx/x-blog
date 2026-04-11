import { fetchPosts, fetchCategories, fetchTags } from '@/lib/api';
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

  const [{ items: posts, pagination }, categories, tags] = await Promise.all([
    fetchPosts({ category_id: categoryId, tag_id: tagId, page, limit: 10 }),
    fetchCategories(),
    fetchTags(),
  ]);

  let baseUrl = '/';
  if (categoryId) baseUrl = `/?category_id=${categoryId}`;
  else if (tagId) baseUrl = `/?tag_id=${tagId}`;

  return (
    <div className="flex gap-8">
      <div className="flex-1">
        <h1 className="text-3xl font-bold mb-8">{categoryId || tagId ? '筛选结果' : '最新文章'}</h1>
        <div className="grid gap-6">
          {posts.length === 0 ? (
            <p className="text-gray-500">暂无文章</p>
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
      <Sidebar categories={categories} tags={tags} />
    </div>
  );
}
