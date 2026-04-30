import { PostList } from '@/types';
import PostCard from '@/components/PostCard';

interface SearchResultsProps {
  posts: PostList[];
  query?: string;
}

export default function SearchResults({ posts }: SearchResultsProps) {
  if (posts.length === 0) {
    return null; // 空状态已在页面处理
  }

  return (
    <div className="space-y-4 mb-8">
      <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
        <span className="px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg font-medium">
          {posts.length}
        </span>
        <span>个搜索结果</span>
      </div>
      <div className="grid gap-6">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}