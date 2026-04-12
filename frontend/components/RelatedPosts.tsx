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
    <section className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
      <h2 className="text-xl font-bold mb-6 dark:text-gray-100">相关文章</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/posts/${post.slug}`}
            className="group block p-4 border border-gray-100 dark:border-gray-800 rounded-xl hover:border-gray-200 dark:hover:border-gray-700 hover:shadow-md transition-all duration-200"
          >
            <h3 className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:hover:text-blue-400 line-clamp-2 mb-2">
              {post.title}
            </h3>
            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              {post.category && <span>{post.category.name}</span>}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}