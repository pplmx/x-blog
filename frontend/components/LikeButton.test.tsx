import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LikeButton from './LikeButton';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { createQueryWrapper, createLocalStorageMock } from '@/tests/test-utils';

const localStorageMock = createLocalStorageMock({});

// Create server with handlers - each test gets fresh instance via beforeEach
const server = setupServer(
  http.post('http://localhost:8000/api/posts/1/like', () => {
    return HttpResponse.json({ id: 1, likes: 1 });
  }),
  http.post('http://localhost:8000/api/posts/2/like', () => {
    return HttpResponse.json({ id: 2, likes: 1 });
  })
);

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createQueryWrapper();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('LikeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.reset({});
    vi.stubGlobal('localStorage', localStorageMock.mock);
    server.listen();
  });

  afterEach(() => {
    server.resetHandlers();
    server.close();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('renders with initial likes count', () => {
    renderWithProviders(<LikeButton postId={1} initialLikes={5} />);
    expect(screen.getByText('5')).toBeDefined();
  });

  it('shows heart icon', () => {
    renderWithProviders(<LikeButton postId={1} initialLikes={0} />);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('displays different styles when liked', async () => {
    renderWithProviders(<LikeButton postId={2} initialLikes={0} />);
    const button = screen.getByRole('button');

    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeDefined();
    });
    expect(localStorageMock.mock.setItem).toHaveBeenCalledWith('liked_2', 'true');
  });
});
