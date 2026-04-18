import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RelatedPosts from './RelatedPosts';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
  createQueryWrapper,
  mockPost,
} from '@/tests/test-utils';

const mockPosts = [
  mockPost({ id: 1, title: 'Related Post 1', slug: 'related-post-1' }),
  mockPost({ id: 2, title: 'Related Post 2', slug: 'related-post-2' }),
];

// Create server with handlers - each test gets fresh instance via beforeEach
const server = setupServer(
  http.get('http://localhost:8000/api/posts/1/related', () => {
    return HttpResponse.json(mockPosts);
  }),
  // Default handler for unmatched requests - return empty array
  http.get(/\/api\/posts\/\d+\/related/, () => {
    return HttpResponse.json([]);
  }),
);

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createQueryWrapper();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('RelatedPosts', () => {
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

  it('renders loading state initially', () => {
    renderWithProviders(<RelatedPosts postId={1} />);
    // Should not throw
    expect(screen.queryByText('相关文章')).toBeNull();
  });

  it('displays related posts when loaded', async () => {
    renderWithProviders(<RelatedPosts postId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Related Post 1')).toBeDefined();
    });
  });

  it('returns null when no related posts', async () => {
    const queryClient = createQueryWrapper();
    queryClient.clear();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RelatedPosts postId={999} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });
});