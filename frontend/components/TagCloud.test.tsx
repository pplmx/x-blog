/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TagCloud from './TagCloud';

describe('TagCloud', () => {
  it('renders tags', () => {
    const tags = [
      { id: 1, name: 'JavaScript' },
      { id: 2, name: 'Python' },
      { id: 3, name: 'React' },
    ];
    render(<TagCloud tags={tags} />);

    expect(screen.getByText('JavaScript')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<TagCloud tags={[]} />);
    expect(screen.getByText('暂无标签')).toBeInTheDocument();
  });

  it('renders with post count', () => {
    const tags = [
      { id: 1, name: 'JavaScript', post_count: 5 },
      { id: 2, name: 'Python', post_count: 3 },
    ];
    render(<TagCloud tags={tags} />);

    expect(screen.getByText('(5)')).toBeInTheDocument();
    expect(screen.getByText('(3)')).toBeInTheDocument();
  });

  it('renders links with correct href', () => {
    const tags = [{ id: 1, name: 'JavaScript' }];
    render(<TagCloud tags={tags} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/?tag_id=1');
  });
});
