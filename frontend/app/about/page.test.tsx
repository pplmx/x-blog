/// <reference types="vitest/globals" />

/**
 * About page tests
 * Tests the static about page content
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AboutPage from './page';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('About Page', () => {
  describe('Static rendering', () => {
    it('renders the about page header', () => {
      render(<AboutPage />);

      expect(screen.getByText('关于 X-Blog')).toBeDefined();
    });

    it('renders the description text', () => {
      render(<AboutPage />);

      expect(screen.getByText(/一个现代化的技术博客系统/)).toBeDefined();
    });

    it('renders the back to home link', () => {
      render(<AboutPage />);

      const backLink = screen.getByText('返回首页');
      expect(backLink).toBeDefined();
      expect(backLink.closest('a')).toHaveAttribute('href', '/');
    });
  });

  describe('Tech stack section', () => {
    it('renders all tech stack items', () => {
      render(<AboutPage />);

      expect(screen.getByText('Next.js')).toBeDefined();
      expect(screen.getByText('FastAPI')).toBeDefined();
      expect(screen.getByText('SQLAlchemy')).toBeDefined();
      expect(screen.getByText('TypeScript')).toBeDefined();
    });

    it('renders tech stack descriptions', () => {
      render(<AboutPage />);

      expect(screen.getByText('前端框架')).toBeDefined();
      expect(screen.getByText('后端框架')).toBeDefined();
      expect(screen.getByText('ORM')).toBeDefined();
      expect(screen.getByText('语言')).toBeDefined();
    });

    it('renders tech stack section header', () => {
      render(<AboutPage />);

      expect(screen.getByText('技术栈')).toBeDefined();
    });
  });

  describe('Features section', () => {
    it('renders all feature items', () => {
      render(<AboutPage />);

      expect(screen.getByText('Markdown 文章支持')).toBeDefined();
      expect(screen.getByText('分类与标签管理')).toBeDefined();
      expect(screen.getByText('评论系统')).toBeDefined();
      expect(screen.getByText('阅读量统计')).toBeDefined();
      expect(screen.getByText('RSS 订阅')).toBeDefined();
      expect(screen.getByText('SEO 优化')).toBeDefined();
      expect(screen.getByText('响应式设计')).toBeDefined();
      expect(screen.getByText('管理后台')).toBeDefined();
    });

    it('renders features section header', () => {
      render(<AboutPage />);

      expect(screen.getByText('核心功能')).toBeDefined();
    });
  });

  describe('Footer', () => {
    it('renders the made with text', () => {
      render(<AboutPage />);

      // Check for "for developers" which appears after "Made with"
      expect(screen.getByText(/for developers/)).toBeDefined();
    });
  });
});
