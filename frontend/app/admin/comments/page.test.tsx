/**
 * Admin comments page tests
 * Uses fresh QueryClient per test to prevent React Query cache pollution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: (_props: any) => {
    const { children, disabled, onClick, className, variant, type, title, ...rest } = _props;
    return (
      <button
        disabled={disabled}
        onClick={onClick}
        className={className}
        data-variant={variant}
        type={type}
        title={title}
        {...rest}
      >
        {children}
      </button>
    );
  },
}));

vi.mock('lucide-react', () => ({
  Trash2: () => <svg data-icon-name="trash2" />,
  CheckCircle: () => <svg data-icon-name="check-circle" />,
  XCircle: () => <svg data-icon-name="x-circle" />,
  MessageCircle: () => <svg data-icon-name="message" />,
  Calendar: () => <svg data-icon-name="calendar" />,
  User: () => <svg data-icon-name="user" />,
  Globe: () => <svg data-icon-name="globe" />,
  Filter: () => <svg data-icon-name="filter" />,
}));

const mocks = {
  fetchAdminComments: vi.fn(),
  deleteAdminComment: vi.fn(),
  approveAdminComment: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  fetchAdminComments: (postId?: number) => mocks.fetchAdminComments(postId),
  deleteAdminComment: (id: number) => mocks.deleteAdminComment(id),
  approveAdminComment: (id: number, approved: boolean) => mocks.approveAdminComment(id, approved),
}));

// Fresh QueryClient per test — prevents React Query cache pollution across tests
const makeWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockComments = [
  {
    id: 1,
    post_id: 1,
    post_title: 'Post 1',
    nickname: 'User1',
    content: 'Comment 1',
    email: 'user1@test.com',
    created_at: '2024-01-01T10:00:00Z',
    is_approved: true,
    ip_address: '127.0.0.1',
  },
  {
    id: 2,
    post_id: 1,
    post_title: 'Post 1',
    nickname: 'User2',
    content: 'Comment 2',
    email: 'user2@test.com',
    created_at: '2024-01-02T10:00:00Z',
    is_approved: false,
    ip_address: '127.0.0.2',
  },
  {
    id: 3,
    post_id: 2,
    post_title: 'Post 2',
    nickname: 'User3',
    content: 'Comment 3',
    email: 'user3@test.com',
    created_at: '2024-01-03T10:00:00Z',
    is_approved: true,
    ip_address: '127.0.0.3',
  },
];

// Find filter tab buttons by text content (no badge requirement)
const findTabByText = (text: string) => {
  const buttons = screen.getAllByRole('button');
  return buttons.find((btn) => {
    const directText = Array.from(btn.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() || '')
      .join('')
      .replace(/\s+/g, ' ');
    return directText === text;
  });
};

describe('Admin Comments Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchAdminComments.mockResolvedValue(mockComments);
    mocks.deleteAdminComment.mockResolvedValue(undefined);
    mocks.approveAdminComment.mockResolvedValue({ id: 2, is_approved: true });
  });

  describe('Header', () => {
    it('renders page title', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => expect(screen.getByText('评论管理')).toBeInTheDocument());
    });

    it('renders comments count', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => expect(screen.getByText(/共 3 条评论/)).toBeInTheDocument());
    });

    it('shows pending count when there are pending comments', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => expect(screen.getByText(/1 条待审核/)).toBeInTheDocument());
    });
  });

  describe('Filter tabs', () => {
    it('renders all filter tab', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => expect(screen.getByText('全部')).toBeInTheDocument());
    });

    it('renders pending filter tab with badge', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        const btn = findTabByText('待审核');
        expect(btn).toBeInTheDocument();
        expect(btn?.querySelector('span')).toBeInTheDocument(); // has badge
      });
    });

    it('renders approved filter tab', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => expect(findTabByText('已通过')).toBeInTheDocument());
    });
  });

  describe('Filter functionality', () => {
    it('shows all comments by default', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        expect(screen.getByText('User1')).toBeInTheDocument();
        expect(screen.getByText('User2')).toBeInTheDocument();
        expect(screen.getByText('User3')).toBeInTheDocument();
      });
    });

    it('filters to show only pending comments', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      const user = userEvent.setup();
      const pendingTab = await waitFor(() => findTabByText('待审核'));
      expect(pendingTab).toBeInTheDocument();
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(pendingTab!);
      await waitFor(() => {
        expect(screen.getByText('User2')).toBeInTheDocument();
        expect(screen.queryByText('User1')).not.toBeInTheDocument();
        expect(screen.queryByText('User3')).not.toBeInTheDocument();
      });
    });

    it('filters to show only approved comments', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      const user = userEvent.setup();
      const approvedTab = await waitFor(() => findTabByText('已通过'));
      expect(approvedTab).toBeInTheDocument();
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(approvedTab!);
      await waitFor(() => {
        expect(screen.getByText('User1')).toBeInTheDocument();
        expect(screen.getByText('User3')).toBeInTheDocument();
        expect(screen.queryByText('User2')).not.toBeInTheDocument();
      });
    });
  });

  describe('Loading state', () => {
    it('renders loading spinner', async () => {
      mocks.fetchAdminComments.mockImplementation(() => new Promise(() => {}));
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        const spinner = document.querySelector('.animate-spin');
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe('Empty state', () => {
    it('renders empty state for all filter', async () => {
      mocks.fetchAdminComments.mockResolvedValue([]);
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        expect(screen.getByText('暂无评论')).toBeInTheDocument();
        expect(screen.getByText('等待读者留下评论')).toBeInTheDocument();
      });
    });

    it('renders empty state for pending filter', async () => {
      // No pending comments at all, so pending tab exists (without badge when count=0)
      mocks.fetchAdminComments.mockResolvedValue(mockComments.filter((c) => c.is_approved));
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      const user = userEvent.setup();
      // Wait for the pending tab button — it exists even without badge when count=0
      const pendingTab = await waitFor(() => findTabByText('待审核'));
      expect(pendingTab).toBeInTheDocument();
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(pendingTab!);
      await waitFor(() => {
        expect(screen.getByText('暂无待审核评论')).toBeInTheDocument();
      });
    });
  });

  describe('Comment display', () => {
    it('renders comment nickname', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        expect(screen.getByText('User1')).toBeInTheDocument();
        expect(screen.getByText('User2')).toBeInTheDocument();
      });
    });

    it('renders comment content', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        expect(screen.getByText('Comment 1')).toBeInTheDocument();
        expect(screen.getByText('Comment 2')).toBeInTheDocument();
      });
    });

    it('renders post link for each comment', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        const postLinks = document.querySelectorAll('a[href^="/admin/posts/"]');
        expect(postLinks.length).toBeGreaterThan(0);
      });
    });

    it('shows pending badge for unapproved comments', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        const badges = document.querySelectorAll('[class*="bg-orange"]');
        expect(badges.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Approve functionality', () => {
    it('renders approve button for pending comments', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        const approveButton = Array.from(document.querySelectorAll('button')).find(
          (btn) => btn.getAttribute('title') === '通过'
        );
        expect(approveButton).toBeInTheDocument();
      });
    });

    it('calls approveAdminComment when approve clicked', async () => {
      mocks.approveAdminComment.mockResolvedValue({ id: 2, is_approved: true });
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      const user = userEvent.setup();
      // Wait for the page to load and show User2 (the pending comment with approve button)
      await waitFor(() => expect(screen.getByText('User2')).toBeInTheDocument());
      // Now find and click the approve button
      const approveButton = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.getAttribute('title') === '通过'
      );
      expect(approveButton).not.toBeUndefined();
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(approveButton!);
      await waitFor(() => {
        expect(mocks.approveAdminComment).toHaveBeenCalled();
      });
    });

    it('renders reject button for approved comments', async () => {
      mocks.fetchAdminComments.mockResolvedValue(
        mockComments.map((c) => ({ ...c, is_approved: true }))
      );
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        const rejectButton = Array.from(document.querySelectorAll('button')).find(
          (btn) => btn.getAttribute('title') === '取消通过'
        );
        expect(rejectButton).toBeInTheDocument();
      });
    });
  });

  describe('Delete functionality', () => {
    it('renders delete button for each comment', async () => {
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => {
        const deleteButtons = Array.from(document.querySelectorAll('button')).filter(
          (btn) => btn.getAttribute('title') === '删除'
        );
        expect(deleteButtons.length).toBe(3);
      });
    });

    it('calls deleteAdminComment when confirmed', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      mocks.deleteAdminComment.mockResolvedValue(undefined);
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      const user = userEvent.setup();
      // Wait for the page to fully load first
      await waitFor(() => expect(screen.getByText('User1')).toBeInTheDocument());
      // Now find the delete button (title="删除")
      const deleteButton = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.getAttribute('title') === '删除'
      );
      expect(deleteButton).not.toBeUndefined();
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(deleteButton!);
      await waitFor(() => {
        expect(window.confirm).toHaveBeenCalled();
        expect(mocks.deleteAdminComment).toHaveBeenCalled();
      });
    });

    it('does not delete when confirmation cancelled', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      const user = userEvent.setup();
      // Wait for the page to fully load first
      await waitFor(() => expect(screen.getByText('User1')).toBeInTheDocument());
      // Now find the delete button (title="删除")
      const deleteButton = Array.from(document.querySelectorAll('button')).find(
        (btn) => btn.getAttribute('title') === '删除'
      );
      expect(deleteButton).not.toBeUndefined();
      // biome-ignore lint/style/noNonNullAssertion: checked above
      await user.click(deleteButton!);
      expect(mocks.deleteAdminComment).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('shows error state when fetch fails', async () => {
      mocks.fetchAdminComments.mockRejectedValue(new Error('Failed to fetch'));
      const CommentsPage = (await import('./page')).default;
      render(<CommentsPage />, { wrapper: makeWrapper() });
      await waitFor(() => expect(screen.getByText(/Error: Failed to fetch/)).toBeInTheDocument());
    });
  });
});
