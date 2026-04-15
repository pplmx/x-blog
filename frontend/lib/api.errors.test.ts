import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APIError, fetchCategories, fetchPost } from './api';

describe('API - Error Handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  describe('APIError', () => {
    it('creates error with status code', () => {
      const error = new APIError('Not found', 404);
      expect(error.message).toBe('Not found');
      expect(error.status).toBe(404);
      expect(error.name).toBe('APIError');
    });

    it('creates error with details', () => {
      const details = { code: 'NOT_FOUND', message: 'Resource not found' };
      const error = new APIError('Error', 404, details);
      expect(error.details).toEqual(details);
    });
  });

  describe('fetchCategories', () => {
    it('throws APIError on failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: { code: 'ERROR', message: 'Bad request' } }),
      });

      await expect(fetchCategories()).rejects.toThrow(APIError);
    });

    it('includes status code in error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { code: 'NOT_FOUND' } }),
      });

      try {
        await fetchCategories();
      } catch (e) {
        expect(e).toBeInstanceOf(APIError);
        expect((e as APIError).status).toBe(404);
      }
    });
  });

  describe('fetchPost', () => {
    it('throws APIError on 404', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: { code: 'POST_NOT_FOUND' } }),
      });

      await expect(fetchPost('nonexistent')).rejects.toThrow(APIError);
    });

    it('parses error details', async () => {
      const errorDetails = { code: 'POST_NOT_FOUND', message: 'Post not found' };
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: errorDetails }),
      });

      try {
        await fetchPost('nonexistent');
      } catch (e) {
        expect((e as APIError).details).toEqual(errorDetails);
      }
    });
  });
});
