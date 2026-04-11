import { fetchPosts, fetchCategories, fetchTags } from "@/lib/api";
import PostCard from "@/components/PostCard";
import Sidebar from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ category_id?: string; tag_id?: string }>;
}) {
  const params = await searchParams;
  const categoryId = params.category_id ? parseInt(params.category_id) : undefined;
  const tagId = params.tag_id ? parseInt(params.tag_id) : undefined;

  const [posts, categories, tags] = await Promise.all([
    fetchPosts({ category_id: categoryId, tag_id: tagId }),
    fetchCategories(),
    fetchTags(),
  ]);

  return (
    <div className="flex gap-8">
      <div className="flex-1">
        <h1 className="text-3xl font-bold mb-8">
          {categoryId || tagId ? "筛选结果" : "最新文章"}
        </h1>
        <div className="grid gap-6">
          {posts.length === 0 ? (
            <p className="text-gray-500">暂无文章</p>
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} />)
          )}
        </div>
      </div>
      <Sidebar categories={categories} tags={tags} />
    </div>
  );
}