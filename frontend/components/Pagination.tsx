'use client';

import Link from 'next/link';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

export default function Pagination({ currentPage, totalPages, baseUrl }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    pages.push(i);
  }

  return (
    <nav aria-label="分页导航" className="flex items-center justify-center gap-2 mt-8">
      {currentPage > 1 && (
        <Link
          href={`${baseUrl}?page=${currentPage - 1}`}
          className="px-3 py-1 border rounded hover:bg-gray-100"
          aria-label="上一页"
        >
          上一页
        </Link>
      )}

      {pages.map((page) => (
        <Link
          key={page}
          href={`${baseUrl}?page=${page}`}
          className={`px-3 py-1 border rounded ${
            page === currentPage ? 'bg-blue-600 text-white' : 'hover:bg-gray-100'
          }`}
          aria-label={`第 ${page} 页`}
          aria-current={page === currentPage ? 'page' : undefined}
        >
          {page}
        </Link>
      ))}

      {currentPage < totalPages && (
        <Link
          href={`${baseUrl}?page=${currentPage + 1}`}
          className="px-3 py-1 border rounded hover:bg-gray-100"
          aria-label="下一页"
        >
          下一页
        </Link>
      )}
    </nav>
  );
}
