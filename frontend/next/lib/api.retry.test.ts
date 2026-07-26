import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  APIError,
  fetchWithTimeout,
  fetchCategories,
  createComment,
  incrementViews,
  incrementLikes,
  fetchAdminPosts,
  fetchAdminPost,
  createAdminPost,
  updateAdminPost,
  deleteAdminPost,
  fetchAdminCategories,
  createAdminCategory,
  updateAdminCategory,
  deleteAdminCategory,
  fetchAdminTags,
  createAdminTag,
  updateAdminTag,
  deleteAdminTag,
  fetchAdminComments,
  deleteAdminComment,
  approveAdminComment,
  adminLogin,
} from './api';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Helper: create a mock Response
function mockResponse(data: unknown, init: { status?: number; statusText?: string } = {}) {
  return {
    ok: init.status ? init.status < 400 : true,
    status: init.status || 200,
    statusText: init.statusText || 'OK',
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  } as unknown as Response;
}

describe('API - Retry Logic and fetchWithTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorageMock.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('fetchWithTimeout - retry on 5xx', () => {
    it('retries on 5xx errors and succeeds on retry', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse(
            { error: 'server error' },
            { status: 500, statusText: 'Internal Server Error' }
          )
        )
        .mockResolvedValueOnce(mockResponse({ data: 'ok' }));

      const promise = fetchWithTimeout('http://localhost:8000/api/posts');

      // Advance past the exponential backoff delay (RETRY_DELAY * 2^0 = 1000ms)
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries up to MAX_RETRIES times then throws last error', async () => {
      // Use 500 responses to trigger retry logic without creating rejected promises
      // from mockRejectedValue (which causes Vitest unhandledRejection warnings).
      // Attach .catch() before advancing fake timers to prevent unhandled rejection
      // detection (throw lastError happens synchronously during advanceTimersByTimeAsync)
      mockFetch.mockResolvedValue(
        mockResponse(
          { error: 'server error' },
          { status: 500, statusText: 'Internal Server Error' }
        )
      );

      const promise = fetchWithTimeout('http://localhost:8000/api/posts');

      // Advance through all retry delays: 1000 + 2000 + 4000 = 7000ms
      // Attach catch handler first to prevent unhandled rejection during timer advancement
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(7000);

      await expect(promise).rejects.toThrow('HTTP 500');
      // Initial attempt + 3 retries = 4 calls
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('does not retry on 4xx errors (except 429)', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'bad' }, { status: 400, statusText: 'Bad Request' })
      );

      const result = await fetchWithTimeout('http://localhost:8000/api/posts');

      expect(result.status).toBe(400);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 429 Too Many Requests', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ error: 'too many' }, { status: 429, statusText: 'Too Many Requests' })
        )
        .mockResolvedValueOnce(mockResponse({ data: 'ok' }));

      const promise = fetchWithTimeout('http://localhost:8000/api/posts');
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws on abort (timeout)', async () => {
      // Mock fetch that rejects when the abort signal fires (simulating timeout)
      // Attach .catch() before advancing fake timers to prevent unhandled rejection
      // detection (the rejection happens synchronously during advanceTimersByTimeAsync)
      mockFetch.mockImplementation((_url: string, options?: RequestInit) => {
        const abortError = new DOMException('The operation was aborted', 'AbortError');
        const signal = (options as { signal?: AbortSignal })?.signal;
        if (signal?.aborted) {
          return Promise.reject(abortError);
        }
        if (signal) {
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              reject(abortError);
            });
          });
        }
        return Promise.reject(abortError);
      });

      const promise = fetchWithTimeout('http://localhost:8000/api/posts', {
        timeout: 100,
        retries: 0,
      });
      // Attach catch handler first to prevent unhandled rejection during timer advancement
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).rejects.toThrow();
    });

    it('does not retry on abort error', async () => {
      // Attach .catch() before advancing fake timers to prevent unhandled rejection
      // detection (mockRejectedValue creates rejected promises that Vitest detects
      // during advanceTimersByTimeAsync before fetchWithTimeout's try/catch processes them)
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      const promise = fetchWithTimeout('http://localhost:8000/api/posts', { timeout: 100 });
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(100);

      await expect(promise).rejects.toBe(abortError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAuthHeaders', () => {
    it('returns empty headers when no token in localStorage', async () => {
      localStorageMock.getItem.mockReturnValue(null);
      mockFetch.mockResolvedValue(mockResponse([]));

      await fetchAdminPosts();

      expect(mockFetch.mock.calls[0][1].headers).toEqual({});
    });

    it('includes Authorization header when token exists', async () => {
      localStorageMock.getItem.mockReturnValue('fake-jwt-token');
      mockFetch.mockResolvedValue(mockResponse([]));

      await fetchAdminPosts();

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer fake-jwt-token');
    });
  });
});

describe('API - Comment Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  describe('createComment', () => {
    it('creates a comment with POST method and JSON body', async () => {
      const mockComment = {
        id: 1,
        post_id: 1,
        nickname: 'Alice',
        email: 'a@test.com',
        content: 'Great!',
      };
      mockFetch.mockResolvedValue(mockResponse(mockComment));

      const result = await createComment(1, {
        nickname: 'Alice',
        email: 'a@test.com',
        content: 'Great!',
      });

      expect(result).toEqual(mockComment);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/comments/post/1',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nickname: 'Alice',
            email: 'a@test.com',
            content: 'Great!',
            parent_id: undefined,
          }),
        })
      );
    });

    it('includes parent_id when provided', async () => {
      const mockComment = {
        id: 2,
        post_id: 1,
        nickname: 'Bob',
        email: 'b@test.com',
        content: 'Reply',
        parent_id: 1,
      };
      mockFetch.mockResolvedValue(mockResponse(mockComment));

      const result = await createComment(1, {
        nickname: 'Bob',
        email: 'b@test.com',
        content: 'Reply',
        parent_id: 1,
      });

      expect(result).toEqual(mockComment);
      expect(mockFetch.mock.calls[0][1].body).toContain('"parent_id":1');
    });

    it('throws APIError on server failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          { error: { code: 'VALIDATION_ERROR' } },
          { status: 400, statusText: 'Bad Request' }
        )
      );

      await expect(
        createComment(1, { nickname: 'Alice', email: 'a@test.com', content: 'Great!' })
      ).rejects.toThrow(APIError);
    });
  });

  describe('incrementViews', () => {
    it('increments views via POST', async () => {
      const mockPost = { id: 1, views: 5 };
      mockFetch.mockResolvedValue(mockResponse(mockPost));

      const result = await incrementViews(1);

      expect(result).toEqual(mockPost);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/posts/1/view',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(incrementViews(999)).rejects.toThrow(APIError);
    });
  });

  describe('incrementLikes', () => {
    it('increments likes via POST', async () => {
      const mockPost = { id: 1, likes: 3 };
      mockFetch.mockResolvedValue(mockResponse(mockPost));

      const result = await incrementLikes(1);

      expect(result).toEqual(mockPost);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/posts/1/like',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(incrementLikes(999)).rejects.toThrow(APIError);
    });
  });
});

describe('API - Admin Posts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('admin-token');
  });

  describe('fetchAdminPosts', () => {
    it('fetches posts with auth header', async () => {
      const mockPosts = [
        {
          id: 1,
          title: 'Test',
          slug: 'test',
          content: '',
          excerpt: '',
          published: false,
          category: null,
          tags: [],
          created_at: '',
          updated_at: '',
        },
      ];
      mockFetch.mockResolvedValue(mockResponse(mockPosts));

      const result = await fetchAdminPosts();

      expect(result).toEqual(mockPosts);
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer admin-token');
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
      );

      await expect(fetchAdminPosts()).rejects.toThrow(APIError);
    });
  });

  describe('fetchAdminPost', () => {
    it('fetches a single post by id', async () => {
      const mockPost = {
        id: 1,
        title: 'Test',
        slug: 'test',
        content: '',
        excerpt: '',
        published: true,
        category_id: null,
        tag_ids: [],
        cover_image: null,
        created_at: '',
        updated_at: '',
      };
      mockFetch.mockResolvedValue(mockResponse(mockPost));

      const result = await fetchAdminPost(1);

      expect(result).toEqual(mockPost);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/admin/posts/1',
        expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } })
      );
    });

    it('throws APIError on 404', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(fetchAdminPost(999)).rejects.toThrow(APIError);
    });
  });
});

describe('API - Admin Categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('admin-token');
  });

  describe('createAdminCategory', () => {
    it('creates a category with POST and JSON body', async () => {
      const mockCategory = { id: 1, name: 'Tech' };
      mockFetch.mockResolvedValue(mockResponse(mockCategory));

      const result = await createAdminCategory('Tech');

      expect(result).toEqual(mockCategory);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(mockFetch.mock.calls[0][1].body).toBe(JSON.stringify({ name: 'Tech' }));
      expect(mockFetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'exists' }, { status: 409, statusText: 'Conflict' })
      );

      await expect(createAdminCategory('Tech')).rejects.toThrow(APIError);
    });
  });

  describe('updateAdminCategory', () => {
    it('updates a category with PUT', async () => {
      const mockCategory = { id: 1, name: 'Updated' };
      mockFetch.mockResolvedValue(mockResponse(mockCategory));

      const result = await updateAdminCategory(1, 'Updated');

      expect(result).toEqual(mockCategory);
      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
      expect(mockFetch.mock.calls[0][1].body).toBe(JSON.stringify({ name: 'Updated' }));
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(updateAdminCategory(999, 'Updated')).rejects.toThrow(APIError);
    });
  });

  describe('deleteAdminCategory', () => {
    it('deletes a category with DELETE', async () => {
      mockFetch.mockResolvedValue(mockResponse({ ok: true }));

      await expect(deleteAdminCategory(1)).resolves.toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer admin-token');
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(deleteAdminCategory(999)).rejects.toThrow('Failed to delete category');
    });
  });
});

describe('API - Admin Tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('admin-token');
  });

  describe('fetchAdminTags', () => {
    it('fetches tags with auth', async () => {
      const mockTags = [{ id: 1, name: 'React' }];
      mockFetch.mockResolvedValue(mockResponse(mockTags));

      const result = await fetchAdminTags();

      expect(result).toEqual(mockTags);
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer admin-token');
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
      );

      await expect(fetchAdminTags()).rejects.toThrow(APIError);
    });
  });

  describe('createAdminTag', () => {
    it('creates a tag', async () => {
      const mockTag = { id: 1, name: 'React' };
      mockFetch.mockResolvedValue(mockResponse(mockTag));

      const result = await createAdminTag('React');

      expect(result).toEqual(mockTag);
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(mockFetch.mock.calls[0][1].body).toBe(JSON.stringify({ name: 'React' }));
    });
  });

  describe('updateAdminTag', () => {
    it('updates a tag', async () => {
      const mockTag = { id: 1, name: 'Vue' };
      mockFetch.mockResolvedValue(mockResponse(mockTag));

      const result = await updateAdminTag(1, 'Vue');

      expect(result).toEqual(mockTag);
      expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
      expect(mockFetch.mock.calls[0][1].body).toBe(JSON.stringify({ name: 'Vue' }));
    });
  });

  describe('deleteAdminTag', () => {
    it('deletes a tag', async () => {
      mockFetch.mockResolvedValue(mockResponse({}));

      await expect(deleteAdminTag(1)).resolves.toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(deleteAdminTag(999)).rejects.toThrow('Failed to delete tag');
    });
  });
});

describe('API - Admin Comments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue('admin-token');
  });

  describe('fetchAdminComments', () => {
    it('fetches all comments when no postId', async () => {
      const mockComments = [
        {
          id: 1,
          post_id: 1,
          post_title: 'Test',
          nickname: 'Alice',
          email: 'a@t.com',
          content: 'hi',
          ip_address: '',
          is_approved: true,
          created_at: '',
        },
      ];
      mockFetch.mockResolvedValue(mockResponse(mockComments));

      const result = await fetchAdminComments();

      expect(result).toEqual(mockComments);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/admin/comments',
        expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } })
      );
    });

    it('fetches filtered comments with postId', async () => {
      const mockComments = [
        {
          id: 1,
          post_id: 1,
          post_title: 'Test',
          nickname: 'Alice',
          email: 'a@t.com',
          content: 'hi',
          ip_address: '',
          is_approved: true,
          created_at: '',
        },
      ];
      mockFetch.mockResolvedValue(mockResponse(mockComments));

      const result = await fetchAdminComments(1);

      expect(result).toEqual(mockComments);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/api/admin/comments?post_id=1',
        expect.objectContaining({ headers: { Authorization: 'Bearer admin-token' } })
      );
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'unauthorized' }, { status: 401, statusText: 'Unauthorized' })
      );

      await expect(fetchAdminComments()).rejects.toThrow(APIError);
    });
  });

  describe('deleteAdminComment', () => {
    it('deletes a comment', async () => {
      mockFetch.mockResolvedValue(mockResponse({}));

      await expect(deleteAdminComment(1)).resolves.toBeUndefined();
      expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(deleteAdminComment(999)).rejects.toThrow('Failed to delete comment');
    });
  });

  describe('approveAdminComment', () => {
    it('approves a comment with PATCH', async () => {
      const mockComment = {
        id: 1,
        post_id: 1,
        post_title: 'Test',
        nickname: 'Alice',
        email: 'a@t.com',
        content: 'hi',
        ip_address: '',
        is_approved: true,
        created_at: '',
      };
      mockFetch.mockResolvedValue(mockResponse(mockComment));

      const result = await approveAdminComment(1, true);

      expect(result).toEqual(mockComment);
      expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
      expect(mockFetch.mock.calls[0][1].body).toBe(JSON.stringify({ approved: true }));
      expect(mockFetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    });

    it('rejects a comment', async () => {
      const mockComment = {
        id: 1,
        post_id: 1,
        post_title: 'Test',
        nickname: 'Alice',
        email: 'a@t.com',
        content: 'hi',
        ip_address: '',
        is_approved: false,
        created_at: '',
      };
      mockFetch.mockResolvedValue(mockResponse(mockComment));

      const result = await approveAdminComment(1, false);
      expect(result.is_approved).toBe(false);
    });

    it('throws APIError on failure', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      );

      await expect(approveAdminComment(999, true)).rejects.toThrow(APIError);
    });
  });
});

describe('API - Admin Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  describe('adminLogin', () => {
    it('submits credentials as form-urlencoded', async () => {
      mockFetch.mockResolvedValue(mockResponse({ access_token: 'jwt-token' }));

      const result = await adminLogin('admin', 'password123');

      expect(result).toEqual({ access_token: 'jwt-token' });
      expect(mockFetch.mock.calls[0][1].method).toBe('POST');
      expect(mockFetch.mock.calls[0][1].headers['Content-Type']).toBe(
        'application/x-www-form-urlencoded'
      );
    });

    it('throws APIError on invalid credentials', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ detail: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' })
      );

      await expect(adminLogin('admin', 'wrong')).rejects.toThrow(APIError);
    });
  });
});

describe('API - handleResponse error parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON error body when response is not ok', async () => {
    const errorBody = { error: { code: 'BAD_REQUEST', message: 'Invalid input' } };
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => errorBody,
      text: async () => JSON.stringify(errorBody),
    } as unknown as Response);

    try {
      await fetchAdminPosts();
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(APIError);
      expect((e as APIError).details).toEqual(errorBody.error);
    }
  });

  it('falls back to text when JSON parsing fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
      text: async () => 'Plain text error',
    } as unknown as Response);

    localStorageMock.getItem.mockReturnValue('token');

    try {
      await fetchAdminPosts();
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(APIError);
      expect((e as APIError).details).toBe('Plain text error');
    }
  });

  it('handles response.ok with res.json()', async () => {
    mockFetch.mockResolvedValue(mockResponse({ success: true }));

    localStorageMock.getItem.mockReturnValue('token');
    const result = await fetchAdminPosts();
    expect(result).toEqual({ success: true });
  });
});
