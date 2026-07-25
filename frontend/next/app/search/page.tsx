import { searchPosts } from '@/lib/api';
import SearchResults from '@/components/SearchResults';
import Pagination from '@/components/Pagination';
import { Search } from 'lucide-react';
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
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-100 dark:from-gray-800 to-white dark:to-gray-900 flex items-center justify-center mb-6">
          <Search className="w-10 h-10 text-gray-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">搜索文章</h2>
        <p className="text-gray-500 dark:text-gray-400">在上方搜索框输入关键词开始搜索</p>
      </div>
    );
  }

  const result = await searchPosts(query, page, 10);

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 dark:from-gray-100 to-gray-600 dark:to-gray-400 bg-clip-text text-transparent">
          搜索结果
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">
          找到 "{query}" 相关文章 {result.pagination.total} 篇
        </p>
      </div>
      {result.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-gradient-to-br from-gray-50 dark:from-gray-800/50 to-white dark:to-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-700 dark:text-gray-300 mb-1">
            没有找到相关文章
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">试试其他关键词吧</p>
        </div>
      ) : (
        <>
          <SearchResults posts={result.items} query={query} />
          <Pagination
            currentPage={page}
            totalPages={result.pagination.total_pages}
            baseUrl={`/search?q=${encodeURIComponent(query)}`}
          />
        </>
      )}
    </div>
  );
}
