import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchBox from './SearchBox';
import * as api from '@/lib/api';
import type { PostList } from '@/types';

// Mock next/navigation at module level
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock the API module
vi.mock('@/lib/api', () => ({
  searchPosts: vi.fn(),
}));

describe('SearchBox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 1, limit: 5, total_pages: 0 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: create a mock PostList
  function mockPost(overrides: Partial<PostList> = {}): PostList {
    return {
      id: 1,
      title: 'Test Post',
      slug: 'test',
      excerpt: 'Test excerpt',
      published: true,
      created_at: '2024-01-01',
      views: 0,
      cover_image: null,
      category: { id: 1, name: 'Tech' },
      tags: [],
      ...overrides,
    };
  }

  it('should render search input', () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    expect(input).toBeDefined();
  });

  it('should show input value when typed', () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'test query' } });
    expect(input.value).toBe('test query');
  });

  it('does not call searchPosts for empty or whitespace query', async () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: '   ' } });
    await waitFor(() => {
      expect(api.searchPosts).not.toHaveBeenCalled();
    });
  });

  it('does not call searchPosts before debounce delay', async () => {
    vi.useFakeTimers();
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });

    vi.advanceTimersByTime(299);
    expect(api.searchPosts).not.toHaveBeenCalled();
  });

  it('calls searchPosts after debounce delay', async () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });

    // Use real timers + waitFor to let the debounce + async resolve
    await waitFor(
      () => {
        expect(api.searchPosts).toHaveBeenCalledWith('hello', 1, 5);
      },
      { timeout: 1000 }
    );
  });

  it('clears suggestions when query becomes empty', async () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'hello' } });
    await waitFor(() => {
      expect(api.searchPosts).toHaveBeenCalled();
    });

    // Clear the query
    fireEvent.change(input, { target: { value: '' } });

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('renders suggestions after search results return', async () => {
    const mockPosts: PostList[] = [mockPost({ id: 1, title: 'First Post' })];
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });

    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('First Post')).toBeDefined();
    });
  });

  it('renders loading state while fetching', async () => {
    vi.mocked(api.searchPosts).mockReturnValue(new Promise(() => {}));

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('加载中...')).toBeDefined();
    });
  });

  it('renders no results message when search returns empty', async () => {
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: [],
      pagination: { total: 0, page: 1, limit: 5, total_pages: 0 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'nonexistent' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('无结果')).toBeDefined();
    });
  });

  it('handles search API error gracefully', async () => {
    vi.mocked(api.searchPosts).mockRejectedValue(new Error('Network error'));

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(api.searchPosts).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByText('无结果')).toBeDefined();
    });
  });

  it('does not navigate on Enter with empty query', () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates on Enter key with non-empty query', async () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'testquery' } });

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockPush).toHaveBeenCalledWith('/search?q=testquery');
  });

  it('closes suggestions and navigates on Enter', async () => {
    const mockPosts: PostList[] = [mockPost({ id: 1, title: 'Found Post' })];
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Found Post')).toBeDefined();
    });

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockPush).toHaveBeenCalledWith('/search?q=hello');
    expect(screen.queryByText('Found Post')).toBeNull();
  });

  it('closes suggestions on Escape key when suggestions are shown', async () => {
    const mockPosts: PostList[] = [mockPost({ id: 1, title: 'Escape Test' })];
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Escape Test')).toBeDefined();
    });

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByText('Escape Test')).toBeNull();
    expect(document.activeElement).not.toBe(input);
  });

  it('does not close on Escape when suggestions are empty', () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toBeDefined();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('shows suggestions on focus when query is non-empty', async () => {
    const mockPosts: PostList[] = [mockPost({ id: 1, title: 'Found Post' })];
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });

    expect(screen.queryByText('Found Post')).toBeNull();

    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Found Post')).toBeDefined();
    });
  });

  it('does not show suggestions on focus when query is empty', () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');

    fireEvent.focus(input);

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes suggestions when clicking outside', async () => {
    const mockPosts: PostList[] = [mockPost({ id: 1, title: 'Outside Test' })];
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    render(
      <div>
        <SearchBox />
        <button data-testid="outside">Outside</button>
      </div>
    );

    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Outside Test')).toBeDefined();
    });

    fireEvent.mouseDown(screen.getByTestId('outside'));

    expect(screen.queryByText('Outside Test')).toBeNull();
  });

  it('clicks a suggestion to navigate to search with the title', async () => {
    const mockPosts: PostList[] = [mockPost({ id: 1, title: 'Clickable Post' })];
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Clickable Post')).toBeDefined();
    });

    const button = screen.getByRole('button', { name: 'Clickable Post' });
    fireEvent.click(button);

    expect(mockPush).toHaveBeenCalledWith('/search?q=Clickable%20Post');
    expect(screen.queryByText('Clickable Post')).toBeNull();
  });

  it('limits suggestions to 5 items', async () => {
    const mockPosts: PostList[] = Array.from({ length: 10 }, (_, i) =>
      mockPost({ id: i + 1, title: `Post ${i + 1}` })
    );
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 10, page: 1, limit: 5, total_pages: 2 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Post 1')).toBeDefined();
    });

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(5);
  });

  it('sets loading to false after successful search completes', async () => {
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: [mockPost({ title: 'Done' })],
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.queryByText('加载中...')).toBeNull();
    });
  });

  it('updates aria-expanded based on suggestions visibility', async () => {
    render(<SearchBox />);
    const input = screen.getByPlaceholderText('搜索文章...') as HTMLInputElement;

    expect(input.getAttribute('aria-expanded')).toBe('false');

    const mockPosts: PostList[] = [mockPost({ id: 1, title: 'Expanded Post' })];
    vi.mocked(api.searchPosts).mockResolvedValue({
      items: mockPosts,
      pagination: { total: 1, page: 1, limit: 5, total_pages: 1 },
    });

    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.focus(input);

    await waitFor(() => {
      expect(input.getAttribute('aria-expanded')).toBe('true');
    });

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});
