/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MobileFilterBar from '@/components/MobileFilterBar';
import { useRouter, useSearchParams } from 'next/navigation';

// Create mock at module level
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

describe('MobileFilterBar', () => {
  const mockCategories = [
    { id: 1, name: 'Tech' },
    { id: 2, name: 'Life' },
  ];

  const mockTags = [
    { id: 1, name: 'javascript' },
    { id: 2, name: 'react' },
  ];

  beforeEach(() => {
    mockPush.mockClear();
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders trigger button', () => {
    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    expect(screen.getByRole('button', { name: /筛选/i })).toBeInTheDocument();
  });

  it('shows "全部文章" when no filters active', () => {
    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    expect(screen.getByText('全部文章')).toBeInTheDocument();
  });

  it('opens panel on button click', async () => {
    const user = userEvent.setup();
    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    const button = screen.getByRole('button', { name: /筛选/i });
    await user.click(button);

    expect(screen.getByText('分类')).toBeInTheDocument();
    expect(screen.getByText('标签')).toBeInTheDocument();
  });

  it('renders categories in panel', async () => {
    const user = userEvent.setup();
    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    await user.click(screen.getByRole('button', { name: /筛选/i }));

    expect(screen.getByText('Tech')).toBeInTheDocument();
    expect(screen.getByText('Life')).toBeInTheDocument();
  });

  it('renders tags in panel', async () => {
    const user = userEvent.setup();
    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    await user.click(screen.getByRole('button', { name: /筛选/i }));

    expect(screen.getByText('#javascript')).toBeInTheDocument();
    expect(screen.getByText('#react')).toBeInTheDocument();
  });

  it('container has lg:hidden class for desktop hiding', () => {
    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    const container = document.querySelector('.lg\\:hidden');
    expect(container).toBeInTheDocument();
  });
});

describe('MobileFilterBar with active filters', () => {
  const mockCategories = [{ id: 1, name: 'Tech' }];
  const mockTags = [{ id: 1, name: 'javascript' }];

  beforeEach(() => {
    mockPush.mockClear();
  });

  it('shows clear all filters button when panel is open with category_id in params', async () => {
    const user = userEvent.setup();
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('category_id=1'));

    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    // Open the panel first
    await user.click(screen.getByRole('button', { name: /筛选/i }));

    expect(screen.getByText('清除所有筛选')).toBeInTheDocument();
  });

  it('clear all filters button is functional', async () => {
    const user = userEvent.setup();
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('category_id=1'));

    render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    // Open the panel first
    await user.click(screen.getByRole('button', { name: /筛选/i }));

    const clearButton = screen.getByText('清除所有筛选');
    await user.click(clearButton);

    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('shows filter indicator when category is active', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('category_id=1'));

    const { container } = render(<MobileFilterBar categories={mockCategories} tags={mockTags} />);

    // Filter indicator text should be present
    expect(container.innerHTML).toContain('筛选中');
  });
});
