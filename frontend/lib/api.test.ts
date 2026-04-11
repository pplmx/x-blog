import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { fetchPosts, fetchPost, createPost, updatePost, deletePost } from './api';

describe('API Error Handling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('fetchPosts handles errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    
    await expect(fetchPosts({})).rejects.toThrow('Network error');
  });

  it('fetchPost throws on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);
    
    await expect(fetchPost('nonexistent')).rejects.toThrow('Failed to fetch post');
  });

  it('createPost throws on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    } as Response);
    
    await expect(createPost({ title: 'Test', slug: 'test', content: 'Content', published: false }))
      .rejects.toThrow('Failed to create post');
  });

  it('updatePost throws on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
    } as Response);
    
    await expect(updatePost(1, { title: 'Updated' })).rejects.toThrow('Failed to update post');
  });

  it('deletePost throws on error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);
    
    await expect(deletePost(999)).rejects.toThrow('Failed to delete post');
  });
});