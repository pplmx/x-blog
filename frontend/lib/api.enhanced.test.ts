import { describe, it, expect, vi } from 'vitest';
import { fetchRelatedPosts, fetchPopularPosts, incrementLikes } from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

describe('API - Enhanced Features', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  describe('fetchRelatedPosts', () => {
    it('fetches related posts for a given post', async () => {
      const mockPosts = [
        { id: 1, title: 'Related', slug: 'related' }
      ];
      
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockPosts
      });

      const result = await fetchRelatedPosts(1, 5);
      expect(result).toEqual(mockPosts);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/posts/1/related?limit=5`
      );
    });

    it('throws error when fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false
      });

      await expect(fetchRelatedPosts(1)).rejects.toThrow('Failed to fetch related posts');
    });
  });

  describe('incrementLikes', () => {
    it('increments likes for a post', async () => {
      const mockPost = { id: 1, likes: 5 };
      
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockPost
      });

      const result = await incrementLikes(1);
      expect(result).toEqual(mockPost);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/posts/1/like`,
        { method: 'POST' }
      );
    });
  });

  describe('fetchPopularPosts', () => {
    it('fetches popular posts with limit', async () => {
      const mockPosts = [
        { id: 1, title: 'Popular', slug: 'popular', views: 1000 }
      ];
      
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockPosts
      });

      const result = await fetchPopularPosts(10);
      expect(result).toEqual(mockPosts);
      expect(global.fetch).toHaveBeenCalledWith(
        `${API_BASE}/api/posts/popular/list?limit=10`
      );
    });
  });
});