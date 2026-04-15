import { describe, it, expect, vi, beforeEach } from 'vitest';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { fetchRelatedPosts, fetchPopularPosts, incrementLikes, APIError } from './api';

describe('API - Enhanced Features', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  describe('fetchRelatedPosts', () => {
    it('fetches related posts for a given post', async () => {
      const mockPosts = [{ id: 1, title: 'Related', slug: 'related' }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPosts,
      } as unknown as Response);

      const result = await fetchRelatedPosts(1, 5);
      expect(result).toEqual(mockPosts);
      expect(mockFetch).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/api/posts/1/related?limit=5`);
    });

    it('throws APIError when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: { code: 'ERROR' } }),
      } as unknown as Response);

      await expect(fetchRelatedPosts(1)).rejects.toThrow(APIError);
    });
  });

  describe('incrementLikes', () => {
    it('increments likes for a post', async () => {
      const mockPost = { id: 1, likes: 5 };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPost,
      } as unknown as Response);

      const result = await incrementLikes(1);
      expect(result).toEqual(mockPost);
      expect(mockFetch).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/api/posts/1/like`);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: { code: 'ERROR' } }),
      } as unknown as Response);

      await expect(incrementLikes(1)).rejects.toThrow(APIError);
    });
  });

  describe('fetchPopularPosts', () => {
    it('fetches popular posts with limit', async () => {
      const mockPosts = [{ id: 1, title: 'Popular' }];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPosts,
      } as unknown as Response);

      const result = await fetchPopularPosts(5);
      expect(result).toEqual(mockPosts);
      expect(mockFetch).toHaveBeenCalled();
      expect(mockFetch.mock.calls[0][0]).toBe(`${API_BASE}/api/posts/popular/list?limit=5`);
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: { code: 'ERROR' } }),
      } as unknown as Response);

      await expect(fetchPopularPosts()).rejects.toThrow(APIError);
    });
  });
});
