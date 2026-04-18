import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Pagination from '@/components/Pagination';

describe('Pagination', () => {
  describe('Rendering', () => {
    it('should return null when totalPages <= 1', () => {
      const { container } = render(
        <Pagination currentPage={1} totalPages={1} baseUrl="/posts" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render page numbers when totalPages > 1', () => {
      render(<Pagination currentPage={1} totalPages={3} baseUrl="/posts" />);
      
      expect(screen.getByText('1')).toBeDefined();
      expect(screen.getByText('2')).toBeDefined();
      expect(screen.getByText('3')).toBeDefined();
    });

    it('should render navigation element', () => {
      render(<Pagination currentPage={1} totalPages={3} baseUrl="/posts" />);
      
      const nav = screen.getByRole('navigation');
      expect(nav).toBeDefined();
    });
  });

  describe('Current page highlighting', () => {
    it('should highlight current page with blue background', () => {
      render(<Pagination currentPage={2} totalPages={5} baseUrl="/posts" />);
      
      // The current page link should have aria-current="page"
      const currentPageLink = screen.getByRole('link', { name: /第 2 页/i });
      expect(currentPageLink).toBeDefined();
      expect(currentPageLink.getAttribute('aria-current')).toBe('page');
    });

    it('should not highlight non-current pages', () => {
      render(<Pagination currentPage={3} totalPages={5} baseUrl="/posts" />);
      
      const page1Link = screen.getByRole('link', { name: /第 1 页/i });
      expect(page1Link.getAttribute('aria-current')).toBeNull();
    });

    it('should show correct current page', () => {
      render(<Pagination currentPage={4} totalPages={10} baseUrl="/posts" />);
      
      expect(screen.getByText('4')).toBeDefined();
    });
  });

  describe('Previous/Next button states', () => {
    it('should not render prev button on first page', () => {
      render(<Pagination currentPage={1} totalPages={3} baseUrl="/posts" />);
      
      expect(screen.queryByText('上一页')).toBeNull();
    });

    it('should render prev button when not on first page', () => {
      render(<Pagination currentPage={2} totalPages={3} baseUrl="/posts" />);
      
      const prevButton = screen.getByRole('link', { name: /上一页/i });
      expect(prevButton).toBeDefined();
    });

    it('should not render next button on last page', () => {
      render(<Pagination currentPage={3} totalPages={3} baseUrl="/posts" />);
      
      expect(screen.queryByText('下一页')).toBeNull();
    });

    it('should render next button when not on last page', () => {
      render(<Pagination currentPage={2} totalPages={5} baseUrl="/posts" />);
      
      const nextButton = screen.getByRole('link', { name: /下一页/i });
      expect(nextButton).toBeDefined();
    });
  });

  describe('URL param updates', () => {
    it('should generate correct URL for each page', () => {
      render(<Pagination currentPage={1} totalPages={3} baseUrl="/posts" />);
      
      const page2Link = screen.getByRole('link', { name: /第 2 页/i });
      expect(page2Link.getAttribute('href')).toBe('/posts?page=2');
    });

    it('should generate correct prev URL', () => {
      render(<Pagination currentPage={3} totalPages={5} baseUrl="/posts" />);
      
      const prevLink = screen.getByRole('link', { name: /上一页/i });
      expect(prevLink.getAttribute('href')).toBe('/posts?page=2');
    });

    it('should generate correct next URL', () => {
      render(<Pagination currentPage={2} totalPages={5} baseUrl="/posts" />);
      
      const nextLink = screen.getByRole('link', { name: /下一页/i });
      expect(nextLink.getAttribute('href')).toBe('/posts?page=3');
    });

    it('should handle baseUrl with trailing slash', () => {
      render(<Pagination currentPage={1} totalPages={3} baseUrl="/posts/" />);
      
      // Link component normalizes the URL, so trailing slash is removed
      const page2Link = screen.getByRole('link', { name: /第 2 页/i });
      expect(page2Link.getAttribute('href')).toBe('/posts?page=2');
    });
  });

  describe('Page click handlers', () => {
    it('should render all page links as clickable', () => {
      render(<Pagination currentPage={1} totalPages={3} baseUrl="/posts" />);
      
      const links = screen.getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
    });
  });
});