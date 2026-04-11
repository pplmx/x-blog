import Link from "next/link";
import { PostList } from "@/types";

interface PostCardProps {
  post: PostList;
}

export default function PostCard({ post }: PostCardProps) {
  const date = new Date(post.created_at).toLocaleDateString("zh-CN");
  
  return (
    <article className="border rounded-lg p-6 hover:shadow-lg transition">
      <Link href={`/posts/${post.slug}`}>
        <h2 className="text-xl font-semibold mb-2 hover:text-blue-600">
          {post.title}
        </h2>
      </Link>
      <div className="text-sm text-gray-500 mb-3">
        <span>{date}</span>
        {post.category && (
          <span className="ml-4 px-2 py-1 bg-gray-100 rounded text-xs">
            {post.category.name}
          </span>
        )}
      </div>
      {post.excerpt && (
        <p className="text-gray-600 mb-4 line-clamp-2">{post.excerpt}</p>
      )}
      <div className="flex gap-2">
        {post.tags.map((tag) => (
          <span
            key={tag.id}
            className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded"
          >
            {tag.name}
          </span>
        ))}
      </div>
    </article>
  );
}