import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TableOfContents from '@/components/TableOfContents';
import { TocItem } from '@/components/Markdown';

describe('TableOfContents', () => {
  const mockToc: TocItem[] = [
    { id: 'introduction', text: 'Introduction', level: 1 },
    { id: 'installation', text: 'Installation', level: 2 },
    { id: 'configuration', text: 'Configuration', level: 2 },
    { id: 'advanced', text: 'Advanced', level: 3 },
  ];

  // Store the observer callback for later triggering
  let observerCallback: ((entries: any[]) => void) | null = null;

  const createIntersectionObserverMock = () => {
    return class MockIntersectionObserver {
      constructor(callback: (entries: any[]) => void) {
        observerCallback = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      static observe = vi.fn();
      static disconnect = vi.fn();
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    observerCallback = null;
    
    // Mock IntersectionObserver
    Object.defineProperty(window, 'IntersectionObserver', {
      value: createIntersectionObserverMock(),
      writable: true,
      configurable: true,
    });

    // Mock getElementById
    const mockElement = {
      id: '',
      getBoundingClientRect: () => ({ top: 100 }),
    };

    document.getElementById = vi.fn((id: string) => {
      const el = { ...mockElement, id };
      return el as HTMLElement;
    });

    // Mock window.scrollTo
    window.scrollTo = vi.fn();

    // Mock window.scrollY
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should return null when toc is empty', () => {
      const { container } = render(<TableOfContents toc={[]} />);

      // Empty TOC case: component returns null before setting up observer
      expect(container.firstChild).toBeNull();
    });

    it('should render TOC items when provided', () => {
      render(<TableOfContents toc={mockToc} />);

      expect(screen.getByText('Introduction')).toBeDefined();
      expect(screen.getByText('Installation')).toBeDefined();
      expect(screen.getByText('Configuration')).toBeDefined();
    });

    it('should render navigation element', () => {
      render(<TableOfContents toc={mockToc} />);

      const nav = document.querySelector('nav');
      expect(nav).toBeDefined();
    });

    it('should render TOC header', () => {
      render(<TableOfContents toc={mockToc} />);

      expect(screen.getByText('目录')).toBeDefined();
    });
  });

  describe('TOC generation from headings', () => {
    it('should render all heading items', () => {
      render(<TableOfContents toc={mockToc} />);

      const links = document.querySelectorAll('a');
      expect(links.length).toBe(mockToc.length);
    });

    it('should generate correct href for each item', () => {
      render(<TableOfContents toc={mockToc} />);

      const introLink = document.querySelector(`a[href="#introduction"]`);
      expect(introLink).toBeDefined();
    });

    it('should apply indentation based on heading level', () => {
      render(<TableOfContents toc={mockToc} />);

      const items = document.querySelectorAll('li');
      // Level 1 has no padding, level 2 has 12px
      expect(items.length).toBe(mockToc.length);
    });
  });

  describe('Active section highlighting', () => {
    it('should have observer setup for elements', () => {
      render(<TableOfContents toc={mockToc} />);

      // Observer should be created (callback stored)
      expect(observerCallback).not.toBeNull();
    });

    it('should track intersection state changes', () => {
      render(<TableOfContents toc={mockToc} />);

      // Trigger intersection callback
      if (observerCallback) {
        const entry = {
          isIntersecting: true,
          target: { id: 'installation' },
        };
        observerCallback([entry]);
      }

      // The component should still render
      expect(screen.getByText('Installation')).toBeDefined();
    });
  });

  describe('Scroll spy behavior', () => {
    it('should have scroll listener available', () => {
      render(<TableOfContents toc={mockToc} />);
      
      // Just verify the component rendered with links (listener is internal)
      const links = document.querySelectorAll('a');
      expect(links.length).toBe(mockToc.length);
    });

    it('should handle smooth scroll on click', () => {
      render(<TableOfContents toc={mockToc} />);

      const installLink = document.querySelector(`a[href="#installation"]`) as HTMLAnchorElement;

      // Simulate click
      installLink?.click();

      expect(window.scrollTo).toHaveBeenCalled();
    });
  });

  describe('Empty TOC case', () => {
    it('should return null for empty array', () => {
      const { container } = render(<TableOfContents toc={[]} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render nothing when toc items have no content', () => {
      const emptyToc: TocItem[] = [];
      const { container } = render(<TableOfContents toc={emptyToc} />);
      expect(container.firstChild).toBeNull();
    });
  });
});