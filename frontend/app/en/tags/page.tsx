import { fetchTags, fetchPosts } from '@/lib/api';
import PostCard from '@/components/PostCard';
import Pagination from '@/components/Pagination';
import type { Metadata } from 'next';

export const dynamic = 'force-static';
export const revalidate = 60;

interface TagsPageProps {
  searchParams: Promise<{ tag_id?: string; page?: string }>;
}

export async function generateMetadata({ searchParams }: TagsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const tagId = params.tag_id;

  if (tagId) {
    return {
      title: 'Tag Posts',
      robots: { noindex: true },
    };
  }

  return {
    title: 'All Tags',
    description: 'Browse all tags on X-Blog',
    alternates: { canonical: '/en/tags' },
  };
}

export default async function TagsPageEN({ searchParams }: TagsPageProps) {
  const params = await searchParams;
  const tagId = params.tag_id ? parseInt(params.tag_id) : undefined;
  const page = params.page ? parseInt(params.page) : 1;

  const tags = await fetchTags();

  // Show all tags
  if (!tagId) {
    return (
      <div>
        <h1 className="text-3xl font-bold mb-8 dark:text-gray-100">All Tags</h1>
        <div className="flex flex-wrap gap-3">
          {tags.map((tag) => (
            <a
              key={tag.id}
              href={`/en/tags?tag_id=${tag.id}`}
              className="px-4 py-2 bg-gradient-to-r from-blue-50 dark:from-blue-900/30 to-indigo-50 dark:to-indigo-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium hover:from-blue-100 dark:hover:from-blue-900/50 hover:to-indigo-100 dark:hover:to-indigo-900/50 transition-all duration-200 hover:shadow-md"
            >
              #{tag.name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  // Show posts for selected tag
  const currentTag = tags.find((t) => t.id === tagId);
  const { items: posts, pagination } = await fetchPosts({ tag_id: tagId, page, limit: 10 });

  return (
    <div>
      <div className="mb-8">
        <a
          href="/en/tags"
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
        >
          ← Back to All Tags
        </a>
        <h1 className="text-3xl font-bold mt-2 dark:text-gray-100">
          Tag: #{currentTag?.name || tagId}
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          {pagination.total} article{pagination.total !== 1 ? 's' : ''}
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No posts yet</p>
      ) : (
        <>
          <div className="grid gap-6">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
          <Pagination
            currentPage={page}
            totalPages={pagination.total_pages}
            baseUrl={`/en/tags?tag_id=${tagId}`}
          />
        </>
      )}
    </div>
  );
}
