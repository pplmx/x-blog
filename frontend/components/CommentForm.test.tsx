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

    expect(screen.getByText('昵称 *')).toBeDefined();
    expect(screen.getByText('邮箱')).toBeDefined();
    expect(screen.getByText('评论内容 *')).toBeDefined();
    expect(screen.getByText('提交评论')).toBeDefined();

    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(3);

    const submitButton = screen.getByRole('button', { name: '提交评论' });
    expect(submitButton).toBeDefined();
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
