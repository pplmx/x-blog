/// <reference types="vitest/globals" />
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { usePathname } from 'next/navigation';
import Header from './Header';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

describe('Header', () => {
  beforeEach(() => {
    vi.mocked(usePathname).mockReturnValue('/');
  });

  it('renders logo link', () => {
    render(<Header />);
    expect(screen.getByText('X-Blog')).toBeDefined();
  });

  it('renders navigation links', () => {
    render(<Header />);
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('关于')).toBeDefined();
  });
});
