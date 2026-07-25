import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  usePosts,
  usePost,
  useCategories,
  useTags,
  useSearchPosts,
  useComments,
  useCreateComment,
  useCreateCategory,
  useCreateTag,
  useCreatePost,
  useUpdatePost,
  useDeletePost,
} from './hooks';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
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

// ============ usePosts ============

describe('usePosts', () => {
  it('fetches posts with default params', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 1,
            title: 'Test',
            slug: 'test',
            excerpt: '...',
            category: 'Cat',
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
        items: [],
        pagination: { total: 0, page: 2, limit: 5, total_pages: 0 },
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
        items: [],
        pagination: { total: 0, page: 1, limit: 10, total_pages: 0 },
      }),
    });
    const { result } = renderHook(() => usePosts({ category_id: 1 }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('fetches posts with tag filter', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
        pagination: { total: 0, page: 1, limit: 10, total_pages: 0 },
      }),
    });
    const { result } = renderHook(() => usePosts({ tag_id: 3 }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

// ============ usePost ============

describe('usePost', () => {
  it('fetches single post by slug', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 1,
        title: 'Test',
        slug: 'test',
        content: 'Content',
        excerpt: '...',
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

  it('is not enabled when slug is empty', () => {
    const { result } = renderHook(() => usePost(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ============ useCategories ============

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

// ============ useTags ============

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

// ============ useSearchPosts ============

describe('useSearchPosts', () => {
  it('fetches search results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 1,
            title: 'Found',
            slug: 'found',
            excerpt: '...',
            category: null,
            tags: [],
            created_at: '',
            updated_at: '',
          },
        ],
        pagination: { total: 1, page: 1, limit: 10, total_pages: 1 },
      }),
    });
    const { result } = renderHook(() => useSearchPosts('test query'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('is not enabled when query is empty', () => {
    const { result } = renderHook(() => useSearchPosts(''), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('fetches search with pagination', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [],
        pagination: { total: 0, page: 2, limit: 5, total_pages: 0 },
      }),
    });
    const { result } = renderHook(() => useSearchPosts('test', 2, 5), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

// ============ useComments ============

describe('useComments', () => {
  it('fetches comments for a post', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 1,
          post_id: 1,
          nickname: 'John',
          content: 'Comment',
          created_at: '',
          is_approved: true,
        },
      ],
    });
    const { result } = renderHook(() => useComments(1), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(Array.isArray(result.current.data)).toBe(true);
  });

  it('is not enabled when postId is falsy', () => {
    const { result } = renderHook(() => useComments(0), { wrapper: createWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});

// ============ Mutation hooks structure ============

describe('useCreateComment', () => {
  it('returns mutation interface', () => {
    const { result } = renderHook(() => useCreateComment(1), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
    expect(result.current.reset).toBeDefined();
  });
});

describe('useCreateCategory', () => {
  it('returns mutation interface', () => {
    const { result } = renderHook(() => useCreateCategory(), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });
});

describe('useCreateTag', () => {
  it('returns mutation interface', () => {
    const { result } = renderHook(() => useCreateTag(), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });
});

describe('useCreatePost', () => {
  it('returns mutation interface', () => {
    const { result } = renderHook(() => useCreatePost(), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });
});

describe('useUpdatePost', () => {
  it('returns mutation interface', () => {
    const { result } = renderHook(() => useUpdatePost(), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });
});

describe('useDeletePost', () => {
  it('returns mutation interface', () => {
    const { result } = renderHook(() => useDeletePost(), { wrapper: createWrapper() });
    expect(result.current.mutate).toBeDefined();
    expect(result.current.mutateAsync).toBeDefined();
  });
});
