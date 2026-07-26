/**
 * Public CRUD API function tests
 * Tests the 5 public API CRUD functions that were added in a previous
 * round but never had test coverage: createCategory, createTag,
 * createPost, updatePost, deletePost.
 *
 * Mocks global.fetch to verify correct URL construction, HTTP method,
 * request body serialization, and response parsing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createCategory,
  createTag,
  createPost,
  updatePost,
  deletePost,
  APIError,
} from './api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Public CRUD API', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('createCategory', () => {
    it('sends POST to /api/categories with name in body', async () => {
      const mockCategory = { id: 1, name: 'Tech' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCategory,
      });

      const result = await createCategory({ name: 'Tech' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/categories');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(options.body)).toEqual({ name: 'Tech' });
      expect(result).toEqual(mockCategory);
    });
  });

  describe('createTag', () => {
    it('sends POST to /api/tags with name in body', async () => {
      const mockTag = { id: 1, name: 'React' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockTag,
      });

      const result = await createTag({ name: 'React' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/tags');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ name: 'React' });
      expect(result).toEqual(mockTag);
    });
  });

  describe('createPost', () => {
    it('sends POST to /api/posts with post data in body', async () => {
      const postData = { title: 'New Post', slug: 'new-post', content: 'Content', published: false };
      const mockResponse = { id: 42 };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await createPost(postData);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/posts');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual(postData);
      expect(result).toEqual({ id: 42 });
    });

    it('includes optional fields in body when provided', async () => {
      const postData = {
        title: 'Post',
        slug: 'post',
        content: 'Content',
        published: true,
        pinned: true,
        category_id: 5,
        tag_ids: [1, 2, 3],
        cover_image: 'https://example.com/cover.jpg',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 1 }),
      });

      await createPost(postData);

      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual(postData);
    });
  });

  describe('updatePost', () => {
    it('sends PATCH to /api/posts/:id with partial data', async () => {
      const mockPost = { id: 1, title: 'Updated', slug: 'updated', content: 'New content' };
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockPost,
      });

      const result = await updatePost(1, { title: 'Updated' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/posts/1');
      expect(options.method).toBe('PATCH');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(options.body)).toEqual({ title: 'Updated' });
      expect(result).toEqual(mockPost);
    });

    it('sends only provided fields as body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: 2 }),
      });

      await updatePost(2, { published: true });

      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ published: true });
    });
  });

  describe('deletePost', () => {
    it('sends DELETE to /api/posts/:id', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => null,
      });

      await deletePost(99);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/posts/99');
      expect(options.method).toBe('DELETE');
    });

    it('throws APIError on non-OK response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { code: 'POST_NOT_FOUND' } }),
      });

      await expect(deletePost(999)).rejects.toThrow(APIError);
    });
  });
});
