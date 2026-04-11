import { fetchPosts } from "@/lib/api";
import PostCard from "@/components/PostCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const posts = await fetchPosts();

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">最新文章</h1>
      <div className="grid gap-6">
        {posts.length === 0 ? (
          <p className="text-gray-500">暂无文章</p>
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>
    </div>
  );
}