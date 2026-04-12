import Link from 'next/link';
import { PostList } from '@/types';
import { Calendar, Eye, ArrowRight } from 'lucide-react';

interface PostCardProps {
  post: PostList;
}

export default function PostCard({ post }: PostCardProps) {
  const date = new Date(post.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <article className="group border border-gray-100 rounded-2xl p-6 hover:border-gray-200 hover:shadow-xl hover:shadow-gray-100/50 transition-all duration-300 bg-white">
      <Link href={`/posts/${post.slug}`}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors duration-200 line-clamp-2">
            {post.title}
          </h2>
          <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all duration-300 shrink-0" />
        </div>
      </Link>
      
      <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
        <span className="flex items-center gap-1">
          <Calendar className="w-4 h-4" />
          {date}
        </span>
        {post.category && (
          <span className="px-3 py-1 bg-gradient-to-r from-gray-50 to-gray-100 rounded-full text-xs font-medium text-gray-600">
            {post.category.name}
          </span>
        )}
        <span className="flex items-center gap-1 ml-auto">
          <Eye className="w-4 h-4" />
          {post.views || 0}
        </span>
      </div>
      
      {post.excerpt && (
        <p className="text-gray-600 mb-4 line-clamp-2 leading-relaxed">
          {post.excerpt}
        </p>
      )}
      
      <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-50">
        {post.tags.map((tag) => (
          <span 
            key={tag.id} 
            className="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 rounded-full font-medium hover:from-blue-100 hover:to-indigo-100 transition-colors duration-200"
          >
            #{tag.name}
          </span>
        ))}
      </div>
    </article>
  );
}
