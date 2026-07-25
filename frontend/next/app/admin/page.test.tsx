/// <reference types="vitest/globals" />

/**
 * Admin dashboard tests
 * Server Component — uses MSW to intercept fetch() at HTTP layer
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  mockPostList,
  mockCategoryList,
  mockTagList,
  mockPostListResponse,
} from '@/tests/test-utils';

// MSW mock data
const mockPosts = mockPostList(5, { published: true, views: 100 });
const mockCategories = mockCategoryList(3);
const mockTags = mockTagList(5);

const server = setupServer(
  http.get('http://localhost:8000/api/posts', () =>
    HttpResponse.json(mockPostListResponse(mockPosts))
  ),
  http.get('http://localhost:8000/api/categories', () => HttpResponse.json(mockCategories)),
  http.get('http://localhost:8000/api/tags', () => HttpResponse.json(mockTags))
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('Admin Dashboard', () => {
  describe('Header', () => {
    it('renders dashboard title', async () => {
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        expect(screen.getByText('仪表盘')).toBeInTheDocument();
      });
    });

    it('renders dashboard description', async () => {
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        expect(screen.getByText('博客数据总览')).toBeInTheDocument();
      });
    });
  });

  describe('Stats cards', () => {
    it('renders all stat cards', async () => {
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        expect(screen.getByText('文章总数')).toBeInTheDocument();
        expect(screen.getByText('已发布')).toBeInTheDocument();
        expect(screen.getByText('草稿')).toBeInTheDocument();
        expect(screen.getByText('分类')).toBeInTheDocument();
        expect(screen.getByText('标签')).toBeInTheDocument();
        expect(screen.getByText('总浏览量')).toBeInTheDocument();
      });
    });

    it('displays correct post count', async () => {
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        // 5 posts total
        const cards = screen.getAllByText('5');
        expect(cards.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Charts section', () => {
    it('renders charts with data', async () => {
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        expect(screen.getByText('热门文章 (浏览量)')).toBeInTheDocument();
        expect(screen.getByText('文章分类分布')).toBeInTheDocument();
      });
    });
  });

  describe('Recent posts section', () => {
    it('renders recent posts section header', async () => {
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        expect(screen.getByText('最近发布的文章')).toBeInTheDocument();
      });
    });

    it('shows empty state when no published posts', async () => {
      server.use(
        http.get('http://localhost:8000/api/posts', () =>
          HttpResponse.json(mockPostListResponse(mockPostList(2, { published: false })))
        )
      );
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        expect(screen.getByText('暂无已发布的文章')).toBeInTheDocument();
      });
    });

    it('renders recent published posts', async () => {
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        // Recent posts section shows up to 5 published posts
        const links = document.querySelectorAll('a[href^="/admin/posts/"]');
        expect(links.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Empty state', () => {
    it('handles newly created blog with no posts', async () => {
      server.use(
        http.get('http://localhost:8000/api/posts', () =>
          HttpResponse.json(mockPostListResponse([]))
        ),
        http.get('http://localhost:8000/api/categories', () => HttpResponse.json([])),
        http.get('http://localhost:8000/api/tags', () => HttpResponse.json([]))
      );
      const AdminDashboard = (await import('./page')).default;
      await act(async () => {
        render(await AdminDashboard());
      });
      await waitFor(() => {
        // Stats should show 0
        const zeros = screen.getAllByText('0');
        expect(zeros.length).toBeGreaterThan(0);
      });
    });
  });
});
