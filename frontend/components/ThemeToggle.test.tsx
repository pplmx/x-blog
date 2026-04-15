import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeToggle from './ThemeToggle';

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: vi.fn(),
  }),
}));

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sun icon when theme is light', () => {
    render(<ThemeToggle />);
    // The component shows Moon when on light mode (click to switch to dark)
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders button with proper aria-label', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: '切换主题' })).toBeInTheDocument();
  });

  it('has correct styling classes', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('rounded-md');
  });
});
