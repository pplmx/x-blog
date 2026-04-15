import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIError } from './api';

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

import { fetchPosts, fetchPost, createAdminPost, updateAdminPost, deleteAdminPost } from './api';

describe('API Error Handling', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorageMock.getItem.mockReset();
  });

  it('fetchPosts handles errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(fetchPosts({})).rejects.toThrow('Network error');
  });

  it('fetchPost throws APIError on 404', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { code: 'POST_NOT_FOUND' } }),
    } as unknown as Response);

    await expect(fetchPost('nonexistent')).rejects.toThrow(APIError);
  });

  it('createAdminPost throws APIError on error', async () => {
    localStorageMock.getItem.mockReturnValue('fake-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: { code: 'VALIDATION_ERROR' } }),
    } as unknown as Response);

    await expect(
      createAdminPost({ title: 'Test', slug: 'test', content: 'Content', published: false })
    ).rejects.toThrow(APIError);
  });

  it('updateAdminPost throws APIError on error', async () => {
    localStorageMock.getItem.mockReturnValue('fake-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: { code: 'VALIDATION_ERROR' } }),
    } as unknown as Response);

    await expect(updateAdminPost(1, { title: 'Updated' })).rejects.toThrow(APIError);
  });

  it('deleteAdminPost throws APIError on error', async () => {
    localStorageMock.getItem.mockReturnValue('fake-token');
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { code: 'POST_NOT_FOUND' } }),
    } as unknown as Response);

    await expect(deleteAdminPost(999)).rejects.toThrow(APIError);
  });

  it('APIError includes status code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: { code: 'ERROR', message: 'Server error' } }),
    } as unknown as Response);

    try {
      await fetchPost('error-post');
    } catch (e) {
      expect(e).toBeInstanceOf(APIError);
      expect((e as APIError).status).toBe(500);
    }
  });
});
