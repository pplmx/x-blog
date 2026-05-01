/**
 * Centralized test utilities for X-Blog frontend tests
 * Eliminates duplicate mock code across all test files
 */
import { type ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { vi, SpyInstance } from 'vitest';

// ============================================================================
// Query Client Utilities
// ============================================================================

/**
 * Creates a QueryClient with retry disabled for tests
 */
export function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return queryClient;
}

/**
 * Creates a wrapper component for testing hooks
 */
export function createQueryWrapperForHooks() {
  const queryClient = createQueryWrapper();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/**
 * Custom render function that includes QueryClientProvider
 */
export function renderWithQuery(ui: ReactNode, options?: Omit<RenderOptions, 'wrapper'>) {
  const queryClient = createQueryWrapper();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>, options);
}

// ============================================================================
// Next.js Router Mocks
// ============================================================================

/**
 * Creates mock functions for Next.js router
 */
export function createRouterMock() {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  };
}

// ============================================================================
// localStorage Mock
// ============================================================================

/**
 * Creates a mock localStorage object
 */
export function createLocalStorageMock(initialState: Record<string, string> = {}) {
  let store: Record<string, string> = { ...initialState };

  const mock: Partial<Storage> = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };

  return {
    mock,
    store,
    reset: (newState: Record<string, string> = {}) => {
      store = { ...newState };
    },
    get: (key: string) => store[key],
    set: (key: string, value: string) => {
      store[key] = value;
    },
  };
}

// ============================================================================
// Intersection Observer Mock
// ============================================================================

/**
 * Mocks IntersectionObserver for scroll-based components
 */
export function mockIntersectionObserver() {
  const mockIntersectionObserver = vi.fn().mockImplementation((callback) => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: '',
    thresholds: [],
    takeRecords: vi.fn().mockReturnValue([]),
    // Trigger callback with mock entry
    __trigger: (entry: Partial<IntersectionObserverEntry> = {}) => {
      callback([
        {
          boundingClientRect: {},
          intersectionRatio: 0,
          intersectionRect: {},
          isIntersecting: true,
          rootBounds: null,
          target: {} as Element,
          time: Date.now(),
          ...entry,
        },
      ]);
    },
  }));

  vi.stubGlobal('IntersectionObserver', mockIntersectionObserver);
  return mockIntersectionObserver;
}

// ============================================================================
// MSW Server Factory - Each test file creates its own server
// ============================================================================

/**
 * Creates a new MSW server with the given handlers
 * Use this in each test file to create a fresh server instance
 */
export function createMSWServer(handlers: Parameters<typeof setupServer>[0] = []) {
  return setupServer(...handlers);
}

// ============================================================================
// Mock Data Factories
// ============================================================================

/**
 * Creates a mock post object
 */
export function mockPost(
  overrides: Partial<{
    id: number;
    title: string;
    slug: string;
    content: string;
    excerpt: string | null;
    published: boolean;
    created_at: string;
    updated_at: string;
    views: number;
    likes: number;
    category: { id: number; name: string } | null;
    tags: Array<{ id: number; name: string }>;
  }> = {}
): {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
  views: number;
  likes: number;
  category: { id: number; name: string } | null;
  tags: Array<{ id: number; name: string }>;
} {
  return {
    id: 1,
    title: 'Test Post',
    slug: 'test-post',
    content: '<p>Test content</p>',
    excerpt: 'Test excerpt',
    published: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    views: 0,
    likes: 0,
    category: { id: 1, name: 'Tech' },
    tags: [],
    ...overrides,
  };
}

/**
 * Creates a list of mock posts
 */
export function mockPostList(
  count: number = 3,
  baseOverrides: Partial<Parameters<typeof mockPost>[0]> = {}
): ReturnType<typeof mockPost>[] {
  return Array.from({ length: count }, (_, i) =>
    mockPost({
      id: i + 1,
      title: `Test Post ${i + 1}`,
      slug: `test-post-${i + 1}`,
      ...baseOverrides,
    })
  );
}

/**
 * Creates a mock category object
 */
export function mockCategory(
  overrides: Partial<{
    id: number;
    name: string;
    slug: string;
    description: string | null;
    post_count: number;
  }> = {}
): {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  post_count: number;
} {
  return {
    id: 1,
    name: 'Tech',
    slug: 'tech',
    description: 'Technology posts',
    post_count: 10,
    ...overrides,
  };
}

/**
 * Creates a list of mock categories
 */
export function mockCategoryList(count: number = 3): ReturnType<typeof mockCategory>[] {
  const names = ['Tech', 'Life', 'Travel', 'Food', 'Health'];
  return Array.from({ length: count }, (_, i) =>
    mockCategory({
      id: i + 1,
      name: names[i] || `Category ${i + 1}`,
      slug: (names[i] || `category-${i + 1}`).toLowerCase(),
      post_count: Math.floor(Math.random() * 20),
    })
  );
}

/**
 * Creates a mock tag object
 */
export function mockTag(
  overrides: Partial<{
    id: number;
    name: string;
    slug: string;
    post_count: number;
  }> = {}
): {
  id: number;
  name: string;
  slug: string;
  post_count: number;
} {
  return {
    id: 1,
    name: 'React',
    slug: 'react',
    post_count: 5,
    ...overrides,
  };
}

/**
 * Creates a list of mock tags
 */
export function mockTagList(count: number = 3): ReturnType<typeof mockTag>[] {
  const names = ['React', 'TypeScript', 'JavaScript', 'Python', 'Node.js'];
  return Array.from({ length: count }, (_, i) =>
    mockTag({
      id: i + 1,
      name: names[i] || `Tag ${i + 1}`,
      slug: (names[i] || `tag-${i + 1}`).toLowerCase().replace('.', '-'),
      post_count: Math.floor(Math.random() * 10) + 1,
    })
  );
}

/**
 * Creates a mock comment object
 */
export function mockComment(
  overrides: Partial<{
    id: number;
    post_id: number;
    nickname: string;
    email: string;
    content: string;
    created_at: string;
  }> = {}
): {
  id: number;
  post_id: number;
  nickname: string;
  email: string;
  content: string;
  created_at: string;
} {
  return {
    id: 1,
    post_id: 1,
    nickname: 'Anonymous',
    email: 'anonymous@example.com',
    content: 'Great post!',
    created_at: '2024-01-01T10:00:00Z',
    ...overrides,
  };
}

/**
 * Creates a list of mock comments
 */
export function mockCommentList(
  count: number = 2,
  postId: number = 1
): ReturnType<typeof mockComment>[] {
  const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
  return Array.from({ length: count }, (_, i) =>
    mockComment({
      id: i + 1,
      post_id: postId,
      nickname: names[i] || `User ${i + 1}`,
      email: `${(names[i] || `user${i + 1}`).toLowerCase()}@example.com`,
      content: `Comment ${i + 1}`,
      created_at: new Date(Date.now() - i * 86400000).toISOString(),
    })
  );
}

/**
 * Creates mock pagination info
 */
export function mockPagination(
  overrides: Partial<{
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  }> = {}
): {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
} {
  return {
    total: 10,
    page: 1,
    limit: 10,
    total_pages: 1,
    ...overrides,
  };
}

/**
 * Creates a mock post list response
 */
export function mockPostListResponse(
  posts: ReturnType<typeof mockPost>[] = mockPostList(),
  pagination?: Partial<Parameters<typeof mockPagination>[0]>
): {
  items: ReturnType<typeof mockPost>[];
  pagination: ReturnType<typeof mockPagination>;
} {
  return {
    items: posts,
    pagination: mockPagination({
      total: posts.length,
      total_pages: Math.ceil(posts.length / 10),
      ...pagination,
    }),
  };
}

/**
 * Creates mock search results
 */
export function mockSearchResults(
  overrides: Partial<{
    posts: ReturnType<typeof mockPost>[];
    total: number;
  }> = {}
): {
  posts: ReturnType<typeof mockPost>[];
  total: number;
} {
  const posts = overrides.posts || mockPostList(2);
  return {
    posts,
    total: overrides.total ?? posts.length,
  };
}

// ============================================================================
// MSW Handler Factories
// ============================================================================

/**
 * Creates an MSW handler for getting posts with optional filtering
 */
export function createPostsHandler(posts: ReturnType<typeof mockPost>[] = mockPostList()) {
  return http.get('http://localhost:8000/api/posts', () =>
    HttpResponse.json(mockPostListResponse(posts))
  );
}

/**
 * Creates an MSW handler for getting a single post
 */
export function createPostHandler(post: ReturnType<typeof mockPost>) {
  return http.get(`http://localhost:8000/api/posts/${post.slug}`, () => HttpResponse.json(post));
}

/**
 * Creates an MSW handler for getting categories
 */
export function createCategoriesHandler(
  categories: ReturnType<typeof mockCategory>[] = mockCategoryList()
) {
  return http.get('http://localhost:8000/api/categories', () => HttpResponse.json(categories));
}

/**
 * Creates an MSW handler for getting tags
 */
export function createTagsHandler(tags: ReturnType<typeof mockTag>[] = mockTagList()) {
  return http.get('http://localhost:8000/api/tags', () => HttpResponse.json(tags));
}

/**
 * Creates an MSW handler for liking a post
 */
export function createLikeHandler(postId: number, likes: number = 1) {
  return http.post(`http://localhost:8000/api/posts/${postId}/like`, () =>
    HttpResponse.json({ id: postId, likes })
  );
}

/**
 * Creates an MSW handler for getting related posts
 */
export function createRelatedPostsHandler(
  postId: number,
  relatedPosts: ReturnType<typeof mockPost>[] = mockPostList(2)
) {
  return http.get(`http://localhost:8000/api/posts/${postId}/related`, () =>
    HttpResponse.json(relatedPosts)
  );
}

/**
 * Creates an MSW handler for getting comments
 */
export function createCommentsHandler(
  postId: number,
  comments: ReturnType<typeof mockComment>[] = mockCommentList()
) {
  return http.get(`http://localhost:8000/api/posts/${postId}/comments`, () =>
    HttpResponse.json(comments)
  );
}

// ============================================================================
// Common Test Setup Functions
// ============================================================================

/**
 * Sets up a complete test environment with all common mocks
 */
export function setupTestEnvironment() {
  beforeEach(() => {
    vi.clearAllMocks();
  });
}

/**
 * Sets up React Query environment
 */
export function setupQueryEnvironment() {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // QueryClient state is managed per-test with createQueryWrapper
  });
}

/**
 * Sets up MSW server environment - creates new server instance each time
 */
export function setupMSWEnvironment(handlers?: Parameters<typeof setupServer>[0]) {
  const server = setupServer(...(handlers || []));

  beforeEach(() => {
    vi.clearAllMocks();
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  return server;
}
