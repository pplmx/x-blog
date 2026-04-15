import Link from 'next/link';
import Image from 'next/image';
import { PostList } from '@/types';
import { Calendar, Eye, ArrowRight } from 'lucide-react';

interface PostCardProps {
  post: PostList;
}

// Default placeholder gradient based on post title hash
function getGradientFromTitle(title: string): string {
  const gradients = [
    'from-blue-500 to-indigo-600',
    'from-emerald-500 to-teal-600',
    'from-orange-500 to-red-600',
    'from-purple-500 to-pink-600',
    'from-cyan-500 to-blue-600',
  ];
  const hash = title.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return gradients[hash % gradients.length];
}

export default function PostCard({ post }: PostCardProps) {
  const date = new Date(post.created_at).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <article className="group border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-xl hover:shadow-gray-100/50 dark:hover:shadow-gray-900/50 transition-all duration-300 bg-white dark:bg-gray-900">
      <Link href={`/posts/${post.slug}`}>
        {/* Cover Image */}
        {post.cover_image ? (
          <div className="relative h-48 w-full overflow-hidden">
            <Image
              src={post.cover_image}
              alt={post.title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-500"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
        ) : (
          <div className={`h-32 bg-gradient-to-br ${getGradientFromTitle(post.title)} opacity-80`}>
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-4xl font-bold text-white/30">
                {post.title.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        )}

        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 transition-colors duration-200 line-clamp-2">
              {post.title}
            </h2>
            <ArrowRight className="w-5 h-5 text-gray-300 group-hover:text-blue-600 group-hover:translate-x-1 transition-all duration-300 shrink-0" />
          </div>

          <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400 mb-4">
            <span className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              {date}
            </span>
            {post.category && (
              <span className="px-3 py-1 bg-gradient-to-r from-gray-50 dark:from-gray-800 to-gray-100 dark:to-gray-700 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300">
                {post.category.name}
              </span>
            )}
            <span className="flex items-center gap-1 ml-auto">
              <Eye className="w-4 h-4" />
              {post.views || 0}
            </span>
          </div>

          {post.excerpt && (
            <p className="text-gray-600 dark:text-gray-300 mb-4 line-clamp-2 leading-relaxed">
              {post.excerpt}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-50 dark:border-gray-800">
            {post.tags.map((tag) => (
              <span
                key={tag.id}
                className="text-xs px-3 py-1.5 bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 text-blue-600 dark:text-blue-400 rounded-full font-medium hover:from-blue-100 dark:hover:from-blue-900/50 hover:to-indigo-100 dark:hover:to-indigo-900/50 transition-colors duration-200"
              >
                #{tag.name}
              </span>
            ))}
          </div>
        </div>
      </Link>
    </article>
  );
}
