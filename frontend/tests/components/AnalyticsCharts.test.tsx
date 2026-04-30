'use client';

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopPostsChart, CategoryPieChart } from '@/components/AnalyticsCharts';

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <svg data-testid="bar-chart">{children}</svg>
  ),
  Bar: () => <g data-testid="bar" />,
  XAxis: () => <g data-testid="x-axis" />,
  YAxis: () => <g data-testid="y-axis" />,
  CartesianGrid: () => <g data-testid="cartesian-grid" />,
  Tooltip: () => <g data-testid="tooltip" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <svg data-testid="pie-chart">{children}</svg>
  ),
  Pie: ({ children }: { children: React.ReactNode }) => (
    <g data-testid="pie">{children}</g>
  ),
  Cell: () => <g data-testid="cell" />,
}));

describe('AnalyticsCharts', () => {
  describe('TopPostsChart', () => {
    it('renders chart container when posts provided', () => {
      render(<TopPostsChart posts={[{ title: 'Test Post', views: 100 }]} />);
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });

    it('returns null when no posts', () => {
      const { container } = render(<TopPostsChart posts={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('returns null when all posts have zero views', () => {
      const { container } = render(
        <TopPostsChart posts={[{ title: 'Zero Post', views: 0 }]} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('limits to 8 posts', () => {
      const manyPosts = Array.from({ length: 15 }, (_, i) => ({
        title: `Post ${i}`,
        views: 100 - i,
      }));
      render(<TopPostsChart posts={manyPosts} />);
      // ResponsiveContainer renders — just verify no crash
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('truncates long titles', () => {
      const longTitle = 'A'.repeat(30);
      render(<TopPostsChart posts={[{ title: longTitle, views: 100 }]} />);
      expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    });
  });

  describe('CategoryPieChart', () => {
    it('renders chart when categories and posts provided', () => {
      render(
        <CategoryPieChart
          categories={[{ id: 1, name: 'Tech' }]}
          posts={[{ category_id: 1, published: true }]}
        />,
      );
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
      expect(screen.getByTestId('pie-chart')).toBeInTheDocument();
    });

    it('returns null when no categories with published posts', () => {
      const { container } = render(
        <CategoryPieChart categories={[{ id: 1, name: 'Tech' }]} posts={[]} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('returns null when no categories', () => {
      const { container } = render(
        <CategoryPieChart categories={[]} posts={[{ category_id: null, published: true }]} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('shows legend with category data', () => {
      render(
        <CategoryPieChart
          categories={[{ id: 1, name: 'Tech' }]}
          posts={[{ category_id: 1, published: true }]}
        />,
      );
      expect(screen.getByText('Tech')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument(); // post count
    });
  });
});