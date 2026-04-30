'use client';

import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

// Simplified page numbers for large page counts
function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | 'ellipsis')[] = [];

  if (current <= 4) {
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('ellipsis');
    pages.push(total);
  } else if (current >= total - 3) {
    pages.push(1);
    pages.push('ellipsis');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    pages.push(1);
    pages.push('ellipsis');
    for (let i = current - 1; i <= current + 1; i++) pages.push(i);
    pages.push('ellipsis');
    pages.push(total);
  }

  return pages;
}

export default function Pagination({ currentPage, totalPages, baseUrl }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = getPageNumbers(currentPage, totalPages);

  const baseClass = "flex items-center justify-center min-w-[2.5rem] h-10 px-3 rounded-xl font-medium text-sm transition-all duration-200 border";
  const normalClass = `${baseClass} bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 dark:hover:from-blue-900/30 dark:hover:to-indigo-900/30 hover:border-blue-200 dark:hover:border-blue-800 hover:text-blue-600 dark:hover:text-blue-400`;
  const activeClass = `${baseClass} bg-gradient-to-r from-blue-500 to-indigo-500 border-transparent text-white shadow-md shadow-blue-500/25`;
  const disabledClass = `${baseClass} bg-gray-50 dark:bg-gray-800/50 border-gray-100 dark:border-gray-800 text-gray-300 dark:text-gray-600 cursor-not-allowed`;

  return (
    <nav aria-label="分页导航" className="flex items-center justify-center gap-1.5 mt-10">
      {/* 首页 */}
      <Link
        href={`${baseUrl}?page=1`}
        className={currentPage === 1 ? disabledClass : `${baseClass} ${normalClass.split(' ').slice(-8).join(' ')}`}
        aria-label="首页"
        aria-disabled={currentPage === 1}
      >
        <ChevronsLeft className="w-4 h-4" />
      </Link>

      {/* 上一页 */}
      <Link
        href={currentPage > 1 ? `${baseUrl}?page=${currentPage - 1}` : '#'}
        className={currentPage === 1 ? disabledClass : `${baseClass} ${normalClass.split(' ').slice(-8).join(' ')}`}
        aria-label="上一页"
        aria-disabled={currentPage === 1}
      >
        <ChevronLeft className="w-4 h-4" />
      </Link>

      {/* 页码 */}
      {pages.map((page, idx) =>
        page === 'ellipsis' ? (
          <span key={`ellipsis-${idx}`} className={`${baseClass} bg-transparent border-transparent text-gray-400 dark:text-gray-600 select-none`}>
            •••
          </span>
        ) : (
          <Link
            key={page}
            href={`${baseUrl}?page=${page}`}
            className={page === currentPage ? activeClass : normalClass}
            aria-label={`第 ${page} 页`}
            aria-current={page === currentPage ? 'page' : undefined}
          >
            {page}
          </Link>
        )
      )}

      {/* 下一页 */}
      <Link
        href={currentPage < totalPages ? `${baseUrl}?page=${currentPage + 1}` : '#'}
        className={currentPage === totalPages ? disabledClass : `${baseClass} ${normalClass.split(' ').slice(-8).join(' ')}`}
        aria-label="下一页"
        aria-disabled={currentPage === totalPages}
      >
        <ChevronRight className="w-4 h-4" />
      </Link>

      {/* 末页 */}
      <Link
        href={`${baseUrl}?page=${totalPages}`}
        className={currentPage === totalPages ? disabledClass : `${baseClass} ${normalClass.split(' ').slice(-8).join(' ')}`}
        aria-label="末页"
        aria-disabled={currentPage === totalPages}
      >
        <ChevronsRight className="w-4 h-4" />
      </Link>
    </nav>
  );
}
