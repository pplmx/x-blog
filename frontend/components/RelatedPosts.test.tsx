import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RelatedPosts from './RelatedPosts';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

const mockPosts = [
  { id: 1, title: 'Related Post 1', slug: 'related-post-1', category: { id: 1, name: 'Tech' } },
  { id: 2, title: 'Related Post 2', slug: 'related-post-2', category: { id: 1, name: 'Tech' } },
];

const server = setupServer(
  http.get('http://localhost:8000/api/posts/1/related', () => {
    return HttpResponse.json(mockPosts);
  })
);

beforeEach(() => {
  server.listen();
});

afterEach(() => {
  server.close();
});

describe('RelatedPosts', () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  it('renders loading state initially', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelatedPosts postId={1} />
      </QueryClientProvider>
    );
    // Should not throw
    expect(screen.queryByText('相关文章')).toBeNull();
  });

  it('displays related posts when loaded', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RelatedPosts postId={1} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Related Post 1')).toBeDefined();
    });
  });

  it('returns null when no related posts', async () => {
    const emptyServer = setupServer(
      http.get('http://localhost:8000/api/posts/999/related', () => {
        return HttpResponse.json([]);
      })
    );
    emptyServer.listen();

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <RelatedPosts postId={999} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });

    emptyServer.close();
  });
});
