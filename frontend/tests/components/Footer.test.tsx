/// <reference types="vitest/globals" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Footer from '@/components/Footer';

// Mock lucide-react icons that may be missing
vi.mock('lucide-react', async () => {
  const actual = await vi.importActual('lucide-react');
  return {
    ...actual,
    // These icons don't exist in some versions, mock them
    Github: (props: object) => <svg {...props} data-testid="github-icon" />,
    Twitter: (props: object) => <svg {...props} data-testid="twitter-icon" />,
    Mail: (props: object) => <svg {...props} data-testid="mail-icon" />,
  };
});

describe('Footer', () => {
  it('renders site name', () => {
    render(<Footer />);

    expect(screen.getByText('X-Blog')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<Footer />);

    expect(screen.getByText('首页')).toBeInTheDocument();
    expect(screen.getByText('标签')).toBeInTheDocument();
    expect(screen.getByText('关于')).toBeInTheDocument();
  });

  it('renders RSS link', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const rssLink = links.find(link => link.getAttribute('href') === '/rss.xml');
    expect(rssLink).toBeInTheDocument();
    expect(rssLink?.getAttribute('title')).toBe('RSS 订阅');
  });

  it('renders Atom link', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const atomLink = links.find(link => link.getAttribute('href') === '/atom.xml');
    expect(atomLink).toBeInTheDocument();
  });

  it('renders GitHub link as external with correct attributes', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const githubLink = links.find(link => link.getAttribute('href') === 'https://github.com');
    expect(githubLink).toBeInTheDocument();
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders copyright text with current year', () => {
    render(<Footer />);

    const currentYear = new Date().getFullYear();
    // Find the copyright span that contains the year
    const allSpans = document.querySelectorAll('footer span');
    const copyrightSpan = Array.from(allSpans).find(span =>
      span.textContent?.includes(String(currentYear)) && span.textContent?.includes('All rights')
    );
    expect(copyrightSpan).toBeDefined();
    expect(copyrightSpan?.textContent).toContain('X-Blog');
  });

  it('renders sitemap link', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const sitemapLink = links.find(link => link.getAttribute('href') === '/sitemap.xml');
    expect(sitemapLink).toBeInTheDocument();
    expect(screen.getByText('网站地图')).toBeInTheDocument();
  });

  it('renders privacy policy link', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const privacyLink = links.find(link => link.getAttribute('href') === '/privacy');
    expect(privacyLink).toBeInTheDocument();
    expect(screen.getByText('隐私政策')).toBeInTheDocument();
  });

  it('home link has correct href', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const homeLink = links.find(link => link.getAttribute('href') === '/' && link.textContent === '首页');
    expect(homeLink).toBeInTheDocument();
  });

  it('tags link has correct href', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const tagsLink = links.find(link => link.getAttribute('href') === '/tags' && link.textContent === '标签');
    expect(tagsLink).toBeInTheDocument();
  });

  it('about link has correct href', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    const aboutLink = links.find(link => link.getAttribute('href') === '/about' && link.textContent === '关于');
    expect(aboutLink).toBeInTheDocument();
  });
});
