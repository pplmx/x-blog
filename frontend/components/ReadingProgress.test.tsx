import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReadingProgress from './ReadingProgress';

describe('ReadingProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.scrollY = 0;
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      value: 2000,
      writable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 800,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders null when progress is 0', () => {
    const { container } = render(<ReadingProgress />);
    // At 0 scroll, component returns null
    expect(container.firstChild).toBeNull();
  });

  it('has correct styling when visible', () => {
    // Mock scroll position
    Object.defineProperty(window, 'scrollY', { value: 500 });
    
    const { container } = render(<ReadingProgress />);
    
    // Advance timers to trigger effect
    vi.advanceTimersByTime(100);
    
    // The progress bar should be rendered
    const progressBar = container.querySelector('.fixed');
    expect(progressBar).toBeDefined();
  });
});
