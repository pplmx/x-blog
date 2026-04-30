'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PostList } from '@/types';
import { fetchRelatedPosts } from '@/lib/api';
import { ArrowRight } from 'lucide-react';

interface RelatedPostsProps {
  postId: number;
}

export default function RelatedPosts({ postId }: RelatedPostsProps) {
  const [posts, setPosts] = useState<PostList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadRelated = async () => {
      try {
        const data = await fetchRelatedPosts(postId, 4);
        setPosts(data);
      } catch (error) {
        console.error('Failed to load related posts:', error);
      } finally {
        setLoading(false);
      }
    };

    if (postId) {
      loadRelated();
    }
  }, [postId]);

  if (loading || posts.length === 0) {
    return null;
  }

  return (
    <section className="mt-12 pt-8 border-t border-gray-100 dark:border-gray-800">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-900 dark:text-gray-100">
        <svg
          aria-label="相关文章"
          className="w-5 h-5 text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        相关文章
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/posts/${post.slug}`}
            className="group block p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-lg transition-all duration-200"
          >
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2 mb-2">
              {post.title}
            </h3>
            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              {post.category && (
                <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">
                  {post.category.name}
                </span>
              )}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
