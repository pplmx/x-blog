/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SearchResults from '@/components/SearchResults';
import { PostList } from '@/types';

describe('SearchResults', () => {
  const mockPosts: PostList[] = [
    {
      id: 1,
      title: 'First Post',
      slug: 'first-post',
      excerpt: 'First post excerpt',
      published: true,
      created_at: '2024-01-01',
      category: { id: 1, name: 'Tech' },
      tags: [{ id: 1, name: 'react' }],
    },
    {
      id: 2,
      title: 'Second Post',
      slug: 'second-post',
      excerpt: 'Second post excerpt',
      published: true,
      created_at: '2024-01-02',
      category: null,
      tags: [],
    },
  ];

  it('renders posts as PostCard grid', () => {
    render(<SearchResults posts={mockPosts} />);
    
    expect(screen.getByText('First Post')).toBeInTheDocument();
    expect(screen.getByText('Second Post')).toBeInTheDocument();
  });

  it('shows result count', () => {
    render(<SearchResults posts={mockPosts} />);
    
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('个搜索结果')).toBeInTheDocument();
  });

  it('shows single result count correctly', () => {
    render(<SearchResults posts={[mockPosts[0]]} />);
    
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('个搜索结果')).toBeInTheDocument();
  });

  it('returns null for empty posts', () => {
    const { container } = render(<SearchResults posts={[]} />);
    
    expect(container.firstChild).toBeNull();
  });

  it('renders query prop but does not use it for display', () => {
    render(<SearchResults posts={mockPosts} query="test" />);
    
    // Query prop is defined but not used in the component
    expect(screen.getByText('First Post')).toBeInTheDocument();
    // Query text should not appear in the results
    expect(screen.queryByText(/test/i)).not.toBeInTheDocument();
  });

  it('renders posts with category information', () => {
    render(<SearchResults posts={mockPosts} />);
    
    expect(screen.getByText('Tech')).toBeInTheDocument();
  });

  it('renders posts with tags', () => {
    render(<SearchResults posts={mockPosts} />);
    
    expect(screen.getByText('#react')).toBeInTheDocument();
  });
});