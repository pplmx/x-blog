import { searchPosts } from '@/lib/api';
import SearchResults from '@/components/SearchResults';
import Pagination from '@/components/Pagination';
import type { Metadata } from 'next';

export const dynamic = 'force-static';
export const revalidate = 60;

interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const query = params.q || '';

  return {
    title: query ? `搜索: ${query}` : '搜索',
    description: query ? `搜索"${query}"的文章结果` : '搜索文章',
    robots: {
      noindex: true,
    },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = params.q || '';
  const page = params.page ? parseInt(params.page) : 1;

  if (!query) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">请输入搜索关键词</p>
      </div>
    );
  }

  const result = await searchPosts(query, page, 10);

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">搜索结果</h1>
      <SearchResults posts={result.items} query={query} />
      <Pagination
        currentPage={page}
        totalPages={result.pagination.total_pages}
        baseUrl={`/search?q=${encodeURIComponent(query)}`}
      />
    </div>
  );
}
