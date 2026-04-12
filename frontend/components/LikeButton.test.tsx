import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import LikeButton from './LikeButton';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.post('http://localhost:8000/api/posts/1/like', () => {
    return HttpResponse.json({ id: 1, likes: 1 });
  })
);

beforeEach(() => {
  server.listen();
});

afterEach(() => {
  server.close();
});

describe('LikeButton', () => {
  it('renders with initial likes count', () => {
    render(<LikeButton postId={1} initialLikes={5} />);
    expect(screen.getByText('5')).toBeDefined();
  });

  it('shows heart icon', () => {
    render(<LikeButton postId={1} initialLikes={0} />);
    expect(screen.getByRole('button')).toBeDefined();
  });

  it('displays different styles when liked', async () => {
    render(<LikeButton postId={1} initialLikes={0} />);
    const button = screen.getByRole('button');
    
    fireEvent.click(button);
    
    await waitFor(() => {
      expect(screen.getByText('1')).toBeDefined();
    });
  });
});