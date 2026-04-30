/// <reference types="vitest/globals" />

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '@/components/Sidebar';
import { useRouter, useSearchParams } from 'next/navigation';

// Mock Next.js router
const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

describe('Sidebar', () => {
  const mockCategories = [
    { id: 1, name: 'Tech' },
    { id: 2, name: 'Life' },
    { id: 3, name: 'Work' },
  ];

  const mockTags = [
    { id: 1, name: 'javascript' },
    { id: 2, name: 'react' },
  ];

  const mockPopularPosts = [
    { id: 1, title: 'Popular Post 1', slug: 'popular-post-1', views: 1000 },
    { id: 2, title: 'Popular Post 2', slug: 'popular-post-2', views: 800 },
  ];

  beforeEach(() => {
    mockPush.mockClear();
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams());
  });

  it('renders categories list as links', () => {
    render(<Sidebar categories={mockCategories} tags={mockTags} />);
    
    const categoryLinks = screen.getAllByRole('link').filter(link => 
      link.getAttribute('href')?.includes('category_id')
    );
    expect(categoryLinks.length).toBe(mockCategories.length);
  });

  it('renders tags list as links', () => {
    render(<Sidebar categories={mockCategories} tags={mockTags} />);
    
    expect(screen.getByText('#javascript')).toBeInTheDocument();
    expect(screen.getByText('#react')).toBeInTheDocument();
  });

  it('renders popular posts list when provided', () => {
    render(<Sidebar categories={mockCategories} tags={mockTags} popularPosts={mockPopularPosts} />);
    
    expect(screen.getByText('热门文章')).toBeInTheDocument();
    expect(screen.getByText('Popular Post 1')).toBeInTheDocument();
    expect(screen.getByText('Popular Post 2')).toBeInTheDocument();
  });

  it('does not render popular posts section when empty', () => {
    render(<Sidebar categories={mockCategories} tags={mockTags} popularPosts={[]} />);
    
    expect(screen.queryByText('热门文章')).not.toBeInTheDocument();
  });

  it('clicking a category link navigates with correct query param', async () => {
    const user = userEvent.setup();
    render(<Sidebar categories={mockCategories} tags={mockTags} />);
    
    const categoryLink = screen.getByRole('link', { name: 'Tech' });
    await user.click(categoryLink);
    
    expect(categoryLink).toHaveAttribute('href', '/?category_id=1');
  });

  it('clicking a tag link navigates with correct query param', async () => {
    const user = userEvent.setup();
    render(<Sidebar categories={mockCategories} tags={mockTags} />);
    
    const tagLink = screen.getByRole('link', { name: '#javascript' });
    
    expect(tagLink).toHaveAttribute('href', '/?tag_id=1');
  });

  it('renders popular post links with correct href', () => {
    render(<Sidebar categories={mockCategories} tags={mockTags} popularPosts={mockPopularPosts} />);
    
    const popularLink = screen.getByRole('link', { name: /Popular Post 1/i });
    expect(popularLink).toHaveAttribute('href', '/posts/popular-post-1');
  });
});

describe('Sidebar with active filters', () => {
  const mockCategories = [{ id: 1, name: 'Tech' }];
  const mockTags = [{ id: 1, name: 'javascript' }];

  beforeEach(() => {
    mockPush.mockClear();
  });

  it('shows clear filters button when category_id is in params', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('category_id=1'));

    render(<Sidebar categories={mockCategories} tags={mockTags} />);
    
    expect(screen.getByText('清除筛选')).toBeInTheDocument();
  });

  it('shows clear filters button when tag_id is in params', () => {
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('tag_id=1'));

    render(<Sidebar categories={mockCategories} tags={mockTags} />);
    
    expect(screen.getByText('清除筛选')).toBeInTheDocument();
  });

  it('clear filters button navigates to home', async () => {
    const user = userEvent.setup();
    
    vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams('category_id=1'));

    render(<Sidebar categories={mockCategories} tags={mockTags} />);
    
    const clearButton = screen.getByRole('button', { name: /清除筛选/i });
    await user.click(clearButton);
    
    expect(mockPush).toHaveBeenCalledWith('/');
  });
});