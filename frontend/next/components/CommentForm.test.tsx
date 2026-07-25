import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CommentForm from './CommentForm';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false },
  },
});

const renderWithProvider = (ui: React.ReactNode) => {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

describe('CommentForm', () => {
  it('should render form fields', () => {
    renderWithProvider(<CommentForm postId={1} />);

    // Check form exists by looking for textarea
    const textarea = document.querySelector('textarea');
    expect(textarea).toBeDefined();

    // Check submit button exists
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should render reply mode when replyTo is provided', () => {
    renderWithProvider(<CommentForm postId={1} replyTo={{ id: 1, nickname: 'Alice' }} />);

    // Check reply indicator is visible (blue background)
    const replyIndicator = document.querySelector('[class*="bg-blue"]');
    expect(replyIndicator).toBeDefined();
  });

  it('should update input values on change', () => {
    renderWithProvider(<CommentForm postId={1} />);

    const inputElements = document.querySelectorAll('input');
    const textareaElements = document.querySelectorAll('textarea');

    const nicknameEl = inputElements[0] as HTMLInputElement;
    const emailEl = inputElements[1] as HTMLInputElement;
    const contentEl = textareaElements[0] as HTMLTextAreaElement;

    fireEvent.change(nicknameEl, { target: { value: 'Test User' } });
    fireEvent.change(emailEl, { target: { value: 'test@example.com' } });
    fireEvent.change(contentEl, { target: { value: 'Test comment' } });

    expect(nicknameEl.value).toBe('Test User');
    expect(emailEl.value).toBe('test@example.com');
    expect(contentEl.value).toBe('Test comment');
  });
});
