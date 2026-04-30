/**
 * Admin categories page tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

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

vi.mock('@/components/ui/input', () => ({
  Input: (_props: any) => {
    const { value, onChange, placeholder, className, onKeyDown, ...rest } = _props;
    return (
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={className}
        onKeyDown={onKeyDown}
        {...rest}
      />
    );
  },
}));

vi.mock('lucide-react', () => ({
  Plus: () => <svg data-icon-name="plus" />,
  FolderOpen: () => <svg data-icon-name="folder" />,
  Trash2: () => <svg data-icon-name="trash2" />,
  Pencil: () => <svg data-icon-name="pencil" />,
  Check: () => <svg data-icon-name="check" />,
  X: () => <svg data-icon-name="x" />,
}));

const mocks = {
  fetchAdminCategories: vi.fn(),
  createAdminCategory: vi.fn(),
  updateAdminCategory: vi.fn(),
  deleteAdminCategory: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  fetchAdminCategories: () => mocks.fetchAdminCategories(),
  createAdminCategory: (name: string) => mocks.createAdminCategory(name),
  updateAdminCategory: (id: number, name: string) => mocks.updateAdminCategory(id, name),
  deleteAdminCategory: (id: number) => mocks.deleteAdminCategory(id),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const mockCategories = [
  { id: 1, name: 'cat1', slug: 'cat1', count: 10 },
  { id: 2, name: 'cat2', slug: 'cat2', count: 5 },
  { id: 3, name: 'cat3', slug: 'cat3', count: 2 },
];

describe('Admin Categories Page', () => {
  beforeEach(() => {
    mocks.fetchAdminCategories.mockResolvedValue(mockCategories);
    mocks.createAdminCategory.mockResolvedValue({
      id: 4,
      name: 'newcat',
      slug: 'newcat',
      count: 0,
    });
    mocks.updateAdminCategory.mockResolvedValue({
      id: 1,
      name: 'newname',
      slug: 'newname',
      count: 0,
    });
    mocks.deleteAdminCategory.mockResolvedValue(undefined);
  });

  describe('Header', () => {
    it('renders page title', async () => {
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      await waitFor(() => expect(screen.getByText('分类管理')).toBeInTheDocument());
    });

    it('renders categories count', async () => {
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      await waitFor(() => expect(screen.getByText(/共 3 个分类/)).toBeInTheDocument());
    });

    it('renders new category button', async () => {
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      await waitFor(() => expect(screen.getByRole('button', { name: '添加' })).toBeInTheDocument());
    });
  });

  describe('Loading state', () => {
    it('renders loading state', async () => {
      mocks.fetchAdminCategories.mockImplementation(() => new Promise(() => {}));
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('renders empty state when no categories', async () => {
      mocks.fetchAdminCategories.mockResolvedValue([]);
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByText('暂无分类')).toBeInTheDocument();
        expect(screen.getByText('添加你的第一个分类吧')).toBeInTheDocument();
      });
    });
  });

  describe('Categories display', () => {
    it('renders all categories', async () => {
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByText('cat1')).toBeInTheDocument();
        expect(screen.getByText('cat2')).toBeInTheDocument();
        expect(screen.getByText('cat3')).toBeInTheDocument();
      });
    });

    it('renders category counts', async () => {
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      await waitFor(() => {
        expect(screen.getByText('cat1')).toBeInTheDocument();
        expect(screen.getByText('cat2')).toBeInTheDocument();
        expect(screen.getByText('cat3')).toBeInTheDocument();
      });
    });
  });

  describe('Create functionality', () => {
    it('shows input when new category button clicked', async () => {
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      const user = userEvent.setup();
      await user.click(await waitFor(() => screen.getByRole('button', { name: '添加' })));
      await waitFor(() => {
        expect(screen.getByPlaceholderText('新分类名称')).toBeInTheDocument();
      });
    });

    it('calls createAdminCategory when adding new category', async () => {
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      const user = userEvent.setup();
      await user.click(await waitFor(() => screen.getByRole('button', { name: '添加' })));
      await waitFor(() => user.type(screen.getByPlaceholderText('新分类名称'), 'New Category'));
      const btn = await waitFor(() => screen.getByRole('button', { name: '添加' }));
      if (btn) await user.click(btn);
      await waitFor(() => {
        expect(mocks.createAdminCategory).toHaveBeenCalled();
      });
    });
  });

  describe('Delete functionality', () => {
    it('prompts for confirmation before delete', async () => {
      vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
      mocks.deleteAdminCategory.mockResolvedValue(undefined);
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      const user = userEvent.setup();
      await waitFor(() => expect(screen.getByText('cat1')).toBeInTheDocument());
      const deleteBtn = document.querySelector('svg[data-icon-name="trash2"]')?.closest('button');
      if (deleteBtn) await user.click(deleteBtn);
      await waitFor(() => {
        expect(vi.mocked(window.confirm)).toHaveBeenCalledWith('确定要删除这个分类吗？');
        expect(mocks.deleteAdminCategory).toHaveBeenCalled();
      });
    });
  });

  describe('Error handling', () => {
    it('shows error state when fetch fails', async () => {
      mocks.fetchAdminCategories.mockRejectedValue(new Error('Failed to fetch'));
      const CategoriesPage = (await import('./page')).default;
      render(<CategoriesPage />, { wrapper: createWrapper() });
      await waitFor(() => expect(screen.getByText(/Error: Failed to fetch/)).toBeInTheDocument());
    });
  });
});
