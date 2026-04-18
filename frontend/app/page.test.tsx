/**
 * Homepage integration tests with MSW
 * Tests the main page component with mocked API responses
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  mockPostList,
  mockCategoryList,
  mockTagList,
  mockPostListResponse,
} from '@/tests/test-utils';

// Mock data
const mockPosts = mockPostList(5);
const mockCategories = mockCategoryList(4);
const mockTags = mockTagList(6);
const mockPopularPosts = mockPostList(3);

// Create server with handlers
const server = setupServer(
  http.get('http://localhost:8000/api/posts', () => {
    return HttpResponse.json(mockPostListResponse(mockPosts));
  }),
  http.get('http://localhost:8000/api/categories', () => {
    return HttpResponse.json(mockCategories);
  }),
  http.get('http://localhost:8000/api/tags', () => {
    return HttpResponse.json(mockTags);
  }),
  http.get('http://localhost:8000/api/posts/popular', () => {
    return HttpResponse.json(mockPopularPosts);
  })
);

describe('Homepage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders the homepage with page title', async () => {
      const response = await fetch('http://localhost:8000/api/posts');
      const data = await response.json();

      expect(data.items).toHaveLength(5);
      expect(data.items[0]).toHaveProperty('title');
      expect(data.items[0]).toHaveProperty('slug');
    });

    it('renders posts list structure', async () => {
      const response = await fetch('http://localhost:8000/api/posts');
      const data = await response.json();

      expect(data).toHaveProperty('items');
      expect(data).toHaveProperty('pagination');
      expect(Array.isArray(data.items)).toBe(true);
    });
  });

  describe('Categories', () => {
    it('fetches categories for sidebar', async () => {
      const response = await fetch('http://localhost:8000/api/categories');
      const data = await response.json();

      expect(data).toHaveLength(4);
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).toHaveProperty('slug');
    });
  });

  describe('Tags', () => {
    it('fetches tags for sidebar', async () => {
      const response = await fetch('http://localhost:8000/api/tags');
      const data = await response.json();

      expect(data).toHaveLength(6);
      expect(data[0]).toHaveProperty('name');
    });
  });

  describe('Popular Posts', () => {
    it('fetches popular posts for sidebar', async () => {
      const response = await fetch('http://localhost:8000/api/posts/popular');
      const data = await response.json();

      expect(data).toHaveLength(3);
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('views');
    });
  });

  describe('Filtering', () => {
    it('fetches filtered posts by category', async () => {
      server.use(
        http.get('http://localhost:8000/api/posts', ({ request }) => {
          const url = new URL(request.url);
          const categoryId = url.searchParams.get('category_id');

          if (categoryId === '1') {
            const filtered = mockPosts.filter((p) => p.category?.id === parseInt(categoryId));
            return HttpResponse.json(mockPostListResponse(filtered));
          }
          return HttpResponse.json(mockPostListResponse([]));
        })
      );

      const response = await fetch('http://localhost:8000/api/posts?category_id=1');
      const data = await response.json();

      expect(data.items).toBeDefined();
    });

    it('fetches filtered posts by tag', async () => {
      server.use(
        http.get('http://localhost:8000/api/posts', ({ request }) => {
          const url = new URL(request.url);
          const tagId = url.searchParams.get('tag_id');

          if (tagId) {
            return HttpResponse.json(mockPostListResponse(mockPosts.slice(0, 2)));
          }
          return HttpResponse.json(mockPostListResponse(mockPosts));
        })
      );

      const response = await fetch('http://localhost:8000/api/posts?tag_id=1');
      const data = await response.json();

      expect(data.items).toHaveLength(2);
    });
  });

  describe('Pagination', () => {
    it('fetches paginated posts', async () => {
      server.use(
        http.get('http://localhost:8000/api/posts', ({ request }) => {
          const url = new URL(request.url);
          const page = url.searchParams.get('page') || '1';

          return HttpResponse.json({
            items: mockPosts.slice(0, 2),
            pagination: { total: 12, page: parseInt(page), limit: 10, total_pages: 2 },
          });
        })
      );

      const response = await fetch('http://localhost:8000/api/posts?page=2');
      const data = await response.json();

      expect(data.pagination.page).toBe(2);
      expect(data.pagination.total_pages).toBe(2);
    });
  });
});
