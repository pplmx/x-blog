import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommentList from './CommentList';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const renderWithProvider = (ui: React.ReactNode) => {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

const mockComments = [
  {
    id: 1,
    post_id: 1,
    nickname: 'Alice',
    email: 'alice@example.com',
    ip_address: '127.0.0.1',
    content: 'Great post!',
    created_at: '2024-01-01T10:00:00Z',
  },
  {
    id: 2,
    post_id: 1,
    nickname: 'Bob',
    email: 'bob@example.com',
    ip_address: '127.0.0.1',
    content: 'Thanks for sharing!',
    created_at: '2024-01-02T11:00:00Z',
  },
];

describe('CommentList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('should render loading state', async () => {
    renderWithProvider(<CommentList postId={1} />);
    expect(screen.getByText('评论加载中...')).toBeDefined();
  });

  it('should render comments when loaded', async () => {
    queryClient.setQueryData(['comments', 1], mockComments);
    renderWithProvider(<CommentList postId={1} />);

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('Bob')).toBeDefined();
    });

    expect(screen.getByText('评论 (2)')).toBeDefined();
  });

  it('should render empty message when no comments', async () => {
    queryClient.setQueryData(['comments', 1], []);
    renderWithProvider(<CommentList postId={1} />);

    await waitFor(() => {
      expect(screen.getByText('暂无评论，快来抢沙发！')).toBeDefined();
    });
  });
});
