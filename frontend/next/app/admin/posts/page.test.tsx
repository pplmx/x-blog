/**
 * Admin posts list page tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPostList } from '@/tests/test-utils';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: (_props: any) => {
    const { children, disabled, onClick, className, variant, title, ...rest } = _props;
    return (
      <button disabled={disabled} onClick={onClick} className={className} title={title} {...rest}>
        {children}
      </button>
    );
  },
}));

vi.mock('lucide-react', () => ({
  Plus: () => <svg data-icon-name="plus" />,
  Pencil: () => <svg data-icon-name="pencil" />,
  Trash2: () => <svg data-icon-name="trash2" />,
  FileText: () => <svg data-icon-name="file-text" />,
}));

const mocks = {
  fetchAdminPosts: vi.fn(),
  deleteAdminPost: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  fetchAdminPosts: () => mocks.fetchAdminPosts(),
  deleteAdminPost: (id: number) => mocks.deleteAdminPost(id),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockPosts = mockPostList(3);

describe('Admin Posts Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Header', () => {
    it('renders page title', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(screen.getByText('文章管理')).toBeInTheDocument());
    });

    it('renders posts count', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(screen.getByText(/共 3 篇文章/)).toBeInTheDocument());
    });

    it('renders new post button', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => {
        const btn = screen.getByText('新建文章');
        expect(btn.closest('a')).toHaveAttribute('href', '/admin/posts/new');
      });
    });
  });

  describe('Loading state', () => {
    it('renders loading state', async () => {
      mocks.fetchAdminPosts.mockImplementation(() => new Promise(() => {}));
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('renders empty state when no posts', async () => {
      mocks.fetchAdminPosts.mockResolvedValue([]);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => {
        expect(screen.getByText('暂无文章')).toBeInTheDocument();
        expect(screen.getByText('开始创建你的第一篇文章吧')).toBeInTheDocument();
      });
    });
  });

  describe('Posts table', () => {
    it('renders posts table', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(document.querySelector('table')).toBeInTheDocument());
    });

    it('renders table headers', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => {
        expect(screen.getByText('标题')).toBeInTheDocument();
        expect(screen.getByText('Slug')).toBeInTheDocument();
        expect(screen.getByText('状态')).toBeInTheDocument();
        expect(screen.getByText('日期')).toBeInTheDocument();
        expect(screen.getByText('操作')).toBeInTheDocument();
      });
    });

    it('renders post titles', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => {
        expect(screen.getByText('Test Post 1')).toBeInTheDocument();
        expect(screen.getByText('Test Post 2')).toBeInTheDocument();
        expect(screen.getByText('Test Post 3')).toBeInTheDocument();
      });
    });

    it('renders published status badge', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(screen.queryAllByText('已发布').length).toBeGreaterThan(0));
    });

    it('renders draft status badge', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts.map((p) => ({ ...p, published: false })));
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(screen.queryAllByText('草稿').length).toBeGreaterThan(0));
    });

    it('renders edit links', async () => {
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => {
        const editLinks = document.querySelectorAll('a[href^="/admin/posts/"]');
        expect(editLinks.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Delete functionality', () => {
    it('prompts for confirmation before delete', async () => {
      const confirmMock = vi.fn().mockReturnValue(true);
      vi.stubGlobal('confirm', confirmMock);
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      mocks.deleteAdminPost.mockResolvedValue(undefined);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(screen.getByText('Test Post 1')).toBeInTheDocument());
      // Posts page delete buttons don't have title - find by trash2 icon
      const deleteBtn = document.querySelector('svg[data-icon-name="trash2"]')?.closest('button');
      if (deleteBtn)
        await act(async () => {
          fireEvent.click(deleteBtn);
        });
      expect(confirmMock).toHaveBeenCalledWith('确定要删除这篇文章吗？');
    });

    it('does not delete when confirmation cancelled', async () => {
      const confirmMock = vi.fn().mockReturnValue(false);
      vi.stubGlobal('confirm', confirmMock);
      mocks.fetchAdminPosts.mockResolvedValue(mockPosts);
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(screen.getByText('Test Post 1')).toBeInTheDocument());
      const deleteBtn = document.querySelector('svg[data-icon-name="trash2"]')?.closest('button');
      if (deleteBtn)
        await act(async () => {
          fireEvent.click(deleteBtn);
        });
      expect(mocks.deleteAdminPost).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('shows error state when fetch fails', async () => {
      mocks.fetchAdminPosts.mockRejectedValue(new Error('Failed to fetch'));
      const PostsPage = (await import('./page')).default;
      await act(async () => {
        render(<PostsPage />, { wrapper: createWrapper() });
      });
      await waitFor(() => expect(screen.getByText(/Error: Failed to fetch/)).toBeInTheDocument());
    });
  });
});
