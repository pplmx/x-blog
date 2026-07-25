import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PostListSkeleton, PostDetailSkeleton, SidebarSkeleton, PageSkeleton } from './Skeleton';

describe('Skeleton Components', () => {
  it('PostListSkeleton renders with skeleton elements', () => {
    render(<PostListSkeleton />);

    // Should have skeleton structure
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('PostDetailSkeleton renders', () => {
    render(<PostDetailSkeleton />);

    // Should have content
    const article = document.querySelector('article');
    expect(article).toBeInTheDocument();
  });

  it('SidebarSkeleton renders with skeleton elements', () => {
    render(<SidebarSkeleton />);

    // Should have skeleton structure
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('PageSkeleton renders both content and sidebar', () => {
    render(<PageSkeleton />);

    // Should have skeleton structure
    const skeletons = document.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);

    // Should have flex layout
    const container = document.querySelector('.flex');
    expect(container).toBeInTheDocument();
  });

  it('all skeletons use Tailwind animate-pulse class', () => {
    const { container } = render(<PageSkeleton />);
    const pulseElements = container.querySelectorAll('.animate-pulse');
    expect(pulseElements.length).toBeGreaterThan(0);
  });
});
