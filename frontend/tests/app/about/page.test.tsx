import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import AboutPage from '@/app/about/page';

describe('About page', () => {
  it('renders page title', () => {
    render(<AboutPage />);
    expect(screen.getByText('关于 X-Blog')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(<AboutPage />);
    expect(screen.getByText('一个现代化的技术博客系统')).toBeInTheDocument();
  });

  it('renders tech stack items', () => {
    render(<AboutPage />);
    expect(screen.getByText('Next.js')).toBeInTheDocument();
    expect(screen.getByText('FastAPI')).toBeInTheDocument();
    expect(screen.getByText('SQLAlchemy')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });

  it('renders tech stack descriptions', () => {
    render(<AboutPage />);
    expect(screen.getByText('前端框架')).toBeInTheDocument();
    expect(screen.getByText('后端框架')).toBeInTheDocument();
    expect(screen.getByText('ORM')).toBeInTheDocument();
    expect(screen.getByText('语言')).toBeInTheDocument();
  });

  it('renders feature items', () => {
    render(<AboutPage />);
    expect(screen.getByText('Markdown 文章支持')).toBeInTheDocument();
    expect(screen.getByText('管理后台')).toBeInTheDocument();
    expect(screen.getByText('RSS 订阅')).toBeInTheDocument();
  });

  it('renders back to home link', () => {
    render(<AboutPage />);
    expect(screen.getByText('返回首页')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /返回首页/ })).toHaveAttribute('href', '/');
  });

  it('renders footer text', () => {
    render(<AboutPage />);
    expect(screen.getByText(/Made with/)).toBeInTheDocument();
    expect(screen.getByText(/for developers/)).toBeInTheDocument();
  });

  it('renders tech stack section header', () => {
    render(<AboutPage />);
    expect(screen.getByText('技术栈')).toBeInTheDocument();
  });

  it('renders features section header', () => {
    render(<AboutPage />);
    expect(screen.getByText('核心功能')).toBeInTheDocument();
  });
});
