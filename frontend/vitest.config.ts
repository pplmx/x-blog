import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'components/**/*.test.{ts,tsx}',
      'lib/**/*.test.{ts,tsx}',
      'app/**/*.test.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
    ],
    exclude: ['e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
        '.next/',
        'e2e/',
        'tests/',
        'vitest.setup.ts',
      ],
      thresholds: {
        branches: 60,
        functions: 55,
        lines: 60,
        statements: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
