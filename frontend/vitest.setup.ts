import '@testing-library/dom';
import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// Suppress expected console warnings in tests
const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);

beforeEach(() => {
  // Filter expected React error boundary warnings
  console.error = vi.fn((...args: unknown[]) => {
    const msg = args[0];
    if (
      typeof msg === 'string' &&
      (msg.includes('ErrorBoundary caught an error') ||
        msg.includes('The above error occurred in the') ||
        msg.includes('React will try to recreate'))
    ) {
      return;
    }
    originalError(...args);
  });

  // Filter MSW localStorage warnings
  console.warn = vi.fn((...args: unknown[]) => {
    const msg = args[0];
    if (typeof msg === 'string' && msg.includes('--localstorage-file')) {
      return;
    }
    originalWarn(...args);
  });
});

afterEach(() => {
  console.error = originalError;
  console.warn = originalWarn;
});
