import '@testing-library/dom';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Global browser APIs
Object.defineProperty(window, 'location', {
  value: { hostname: 'localhost', origin: 'http://localhost' },
  writable: true, configurable: true,
});
window.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} } as any;

// vi.hoisted: mocks + references are hoisted together so vi.mock can access them
const { mermaidInitMock, mermaidRenderMock, openLightboxMock } = vi.hoisted(() => {
  const mi = vi.fn();
  const mr = vi.fn(async (id: string, _code: string) => ({
    svg: `<svg id="${id}"><text>Diagram</text></svg>`,
  }));
  const ol = vi.fn();
  return { mermaidInitMock: mi, mermaidRenderMock: mr, openLightboxMock: ol };
});

vi.mock('mermaid', () => ({
  default: { initialize: mermaidInitMock, render: mermaidRenderMock },
}));
vi.mock('@/components/ImageLightboxContext', () => ({
  useImageLightbox: () => ({ openLightbox: openLightboxMock }),
}));

export const testMocks = {
  mermaidInit: mermaidInitMock,
  mermaidRender: mermaidRenderMock,
  openLightbox: openLightboxMock,
};

const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);

beforeEach(() => {
  console.error = vi.fn((...args: unknown[]) => {
    const msg = args[0];
    if (typeof msg === 'string' && (msg.includes('ErrorBoundary') || msg.includes('above error'))) return;
    originalError(...args);
  });
  console.warn = vi.fn((...args: unknown[]) => {
    const msg = args[0];
    if (typeof msg === 'string' && msg.includes('--localstorage-file')) return;
    originalWarn(...args);
  });
});

afterEach(() => {
  cleanup();
  console.error = originalError;
  console.warn = originalWarn;
  openLightboxMock.mockClear();
  mermaidInitMock.mockClear();
  mermaidRenderMock.mockClear();
});
