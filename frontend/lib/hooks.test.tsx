import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePosts, usePost, useCategories, useTags } from './hooks';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockFetch = vi.fn();

beforeAll(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  mockFetch.mockReset();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('usePosts', () => {
  it('fetches posts with default params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 1,
            title: 'Test Post',
            slug: 'test-post',
            excerpt: 'Test',
            category: 'Test',
            tags: [],
            created_at: '',
            updated_at: '',
          },
        ],
        pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
      }),
    });

    const { result } = renderHook(() => usePosts({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
  });

  it('fetches posts with pagination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 1,
            title: 'Test Post',
            slug: 'test-post',
            excerpt: 'Test',
            category: 'Test',
            tags: [],
            created_at: '',
            updated_at: '',
          },
        ],
        pagination: { total: 1, page: 2, limit: 5, total_pages: 1 },
      }),
    });

    const { result } = renderHook(() => usePosts({ page: 2, limit: 5 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('fetches posts with category filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 1,
            title: 'Test Post',
            slug: 'test-post',
            excerpt: 'Test',
            category: 'Test',
            tags: [],
            created_at: '',
            updated_at: '',
          },
        ],
        pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
      }),
    });

    const { result } = renderHook(() => usePosts({ category_id: 1 }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('usePost', () => {
  it('fetches single post by slug', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 1,
        title: 'Test Post',
        slug: 'test-post',
        content: 'Content',
        excerpt: 'Test',
        published: true,
        category: null,
        tags: [],
        created_at: '',
        updated_at: '',
      }),
    });

    const { result } = renderHook(() => usePost('test-slug'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useCategories', () => {
  it('fetches categories', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 1, name: 'Test Category' }],
    });

    const { result } = renderHook(() => useCategories(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Array.isArray(result.current.data)).toBe(true);
  });
});

describe('useTags', () => {
  it('fetches tags', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 1, name: 'Test Tag' }],
    });

    const { result } = renderHook(() => useTags(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Array.isArray(result.current.data)).toBe(true);
  });
});
