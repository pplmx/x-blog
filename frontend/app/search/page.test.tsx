/**
 * Search page tests
 * Tests the search results page with different query parameters
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { mockPostList, mockPostListResponse } from '@/tests/test-utils';
import { Search } from 'lucide-react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// Mock the API
const mockSearchPosts = vi.fn();
vi.mock('@/lib/api', () => ({
  searchPosts: (...args: unknown[]) => mockSearchPosts(...args),
}));

// Create mock data
const mockPosts = mockPostList(5);

// MSW server
const server = setupServer(
  http.get('http://localhost:8000/api/posts/search', () => {
    return HttpResponse.json(mockPostListResponse(mockPosts));
  })
);

describe('Search Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  describe('Without search query', () => {
    it('renders empty search state', async () => {
      const { default: SearchPage } = await import('./page');

      // Render with no query
      mockSearchPosts.mockRejectedValue(new Error('No query provided'));

      render(
        await SearchPage({
          searchParams: Promise.resolve({}),
        })
      );

      expect(screen.getByText('搜索文章')).toBeDefined();
      expect(screen.getByText('在上方搜索框输入关键词开始搜索')).toBeDefined();
    });
  });

  describe('With search query', () => {
    it('renders search results header with query', async () => {
      const { default: SearchPage } = await import('./page');

      mockSearchPosts.mockResolvedValue({
        items: mockPosts,
        pagination: { total: 5, page: 1, limit: 10, total_pages: 1 },
      });

      render(
        await SearchPage({
          searchParams: Promise.resolve({ q: 'test' }),
        })
      );

      expect(screen.getByText('搜索结果')).toBeDefined();
      expect(screen.getByText(/找到 "test" 相关文章/)).toBeDefined();
    });

    it('renders empty results state', async () => {
      const { default: SearchPage } = await import('./page');

      mockSearchPosts.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, limit: 10, total_pages: 0 },
      });

      render(
        await SearchPage({
          searchParams: Promise.resolve({ q: 'nonexistent' }),
        })
      );

      expect(screen.getByText('没有找到相关文章')).toBeDefined();
      expect(screen.getByText('试试其他关键词吧')).toBeDefined();
    });

    it('shows pagination when results exceed page size', async () => {
      const { default: SearchPage } = await import('./page');
      const manyPosts = mockPostList(15);

      mockSearchPosts.mockResolvedValue({
        items: manyPosts.slice(0, 10),
        pagination: { total: 15, page: 1, limit: 10, total_pages: 2 },
      });

      render(
        await SearchPage({
          searchParams: Promise.resolve({ q: 'test', page: '1' }),
        })
      );

      // Check for pagination element - either the pagination component or page links
      const paginationExists =
        document.querySelector('nav') !== null ||
        document.querySelector('[class*="pagination"]') !== null;
      expect(paginationExists).toBeTruthy();
    });
  });

  describe('Pagination', () => {
    it('passes page parameter to search', async () => {
      const { default: SearchPage } = await import('./page');

      mockSearchPosts.mockResolvedValue({
        items: mockPosts.slice(0, 10),
        pagination: { total: 15, page: 2, limit: 10, total_pages: 2 },
      });

      await SearchPage({
        searchParams: Promise.resolve({ q: 'test', page: '2' }),
      });

      expect(mockSearchPosts).toHaveBeenCalledWith('test', 2, 10);
    });

    it('defaults to page 1 when page not specified', async () => {
      const { default: SearchPage } = await import('./page');

      mockSearchPosts.mockResolvedValue({
        items: mockPosts,
        pagination: { total: 5, page: 1, limit: 10, total_pages: 1 },
      });

      await SearchPage({
        searchParams: Promise.resolve({ q: 'test' }),
      });

      expect(mockSearchPosts).toHaveBeenCalledWith('test', 1, 10);
    });
  });
});
