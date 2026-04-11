import { PostList } from "@/types";
import PostCard from "@/components/PostCard";

interface SearchResultsProps {
  posts: PostList[];
  query: string;
}

export default function SearchResults({ posts, query }: SearchResultsProps) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">未找到与 "{query}" 相关的文章</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-6 text-gray-600">找到 {posts.length} 个结果</p>
      <div className="grid gap-6">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}