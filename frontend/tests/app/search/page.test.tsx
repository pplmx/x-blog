/**
 * Search page tests
 * Tests search results page with focus on: search params, results display, loading state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mockPostList, mockPagination } from '@/tests/test-utils';
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

describe('Search Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Search params handling', () => {
    it('shows empty state when no query parameter provided', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      render(
        await SearchPage({
          searchParams: Promise.resolve({}),
        })
      );

      expect(screen.getByText('搜索文章')).toBeInTheDocument();
      expect(screen.getByText('在上方搜索框输入关键词开始搜索')).toBeInTheDocument();
      // Verify Search icon is present (search SVG is rendered)
      expect(document.querySelector('.lucide-search')).toBeTruthy();
    });

    it('parses page parameter and passes to search function', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      mockSearchPosts.mockResolvedValue({
        items: [],
        pagination: mockPagination({ total: 0, total_pages: 0 }),
      });

      await SearchPage({
        searchParams: Promise.resolve({ q: 'test', page: '3' }),
      });

      // Verify searchPosts was called with correct page parameter
      expect(mockSearchPosts).toHaveBeenCalledWith('test', 3, 10);
    });

    it('defaults to page 1 when page parameter is missing', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      mockSearchPosts.mockResolvedValue({
        items: mockPostList(5),
        pagination: mockPagination({ total: 5, page: 1, total_pages: 1 }),
      });

      await SearchPage({
        searchParams: Promise.resolve({ q: 'test' }),
      });

      expect(mockSearchPosts).toHaveBeenCalledWith('test', 1, 10);
    });
  });

  describe('Results display', () => {
    it('displays search results header with query and total count', async () => {
      const { default: SearchPage } = await import('@/app/search/page');
      const posts = mockPostList(3);

      mockSearchPosts.mockResolvedValue({
        items: posts,
        pagination: mockPagination({ total: 3, page: 1, total_pages: 1 }),
      });

      render(
        await SearchPage({
          searchParams: Promise.resolve({ q: 'react hooks' }),
        })
      );

      expect(screen.getByText('搜索结果')).toBeInTheDocument();
      expect(screen.getByText(/找到 "react hooks" 相关文章 3 篇/)).toBeInTheDocument();
    });

    it('shows empty results state when no posts match', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      mockSearchPosts.mockResolvedValue({
        items: [],
        pagination: mockPagination({ total: 0, total_pages: 0 }),
      });

      render(
        await SearchPage({
          searchParams: Promise.resolve({ q: 'nonexistent' }),
        })
      );

      expect(screen.getByText('没有找到相关文章')).toBeInTheDocument();
      expect(screen.getByText('试试其他关键词吧')).toBeInTheDocument();
    });

    it('displays SearchResults component with posts', async () => {
      const { default: SearchPage } = await import('@/app/search/page');
      const posts = mockPostList(2);

      mockSearchPosts.mockResolvedValue({
        items: posts,
        pagination: mockPagination({ total: 2, total_pages: 1 }),
      });

      render(
        await SearchPage({
          searchParams: Promise.resolve({ q: 'test' }),
        })
      );

      // Check that SearchResults displays the post titles
      expect(screen.getByText('Test Post 1')).toBeInTheDocument();
      expect(screen.getByText('Test Post 2')).toBeInTheDocument();
    });

    it('displays gradient text styling for results header', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      mockSearchPosts.mockResolvedValue({
        items: mockPostList(1),
        pagination: mockPagination({ total: 1, total_pages: 1 }),
      });

      render(
        await SearchPage({
          searchParams: Promise.resolve({ q: 'test' }),
        })
      );

      // Check for gradient text class
      const heading = screen.getByText('搜索结果');
      expect(heading.className).toContain('bg-clip-text');
    });
  });

  describe('Loading state handling', () => {
    it('renders empty state immediately when no query is provided (no loading needed)', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      // When no query, the component doesn't call the API - no loading state
      const rendered = await SearchPage({
        searchParams: Promise.resolve({}),
      });

      render(rendered);

      // Should show empty search state directly, no loading spinner
      expect(screen.queryByText(/加载|loading/i)).not.toBeInTheDocument();
      expect(screen.getByText('搜索文章')).toBeInTheDocument();
    });

    it('searchPosts is only called when query is provided', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      mockSearchPosts.mockResolvedValue({
        items: [],
        pagination: mockPagination({ total: 0, total_pages: 0 }),
      });

      // Render with empty query first
      await SearchPage({
        searchParams: Promise.resolve({}),
      });

      expect(mockSearchPosts).not.toHaveBeenCalled();

      // Clear and render with query
      mockSearchPosts.mockClear();
      
      await SearchPage({
        searchParams: Promise.resolve({ q: 'test' }),
      });

      expect(mockSearchPosts).toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('handles searchPosts API error gracefully', async () => {
      const { default: SearchPage } = await import('@/app/search/page');

      mockSearchPosts.mockRejectedValue(new Error('API Error'));

      // The server component will throw on API error - this tests that error propagation works
      await expect(
        SearchPage({
          searchParams: Promise.resolve({ q: 'test' }),
        })
      ).rejects.toThrow('API Error');
    });
  });
});
