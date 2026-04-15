import { Post, PostList, Category, Tag, SearchResult } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const REQUEST_TIMEOUT = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// Custom error class with status code
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'APIError';
  }
}

interface FetchOptions extends RequestInit {
  timeout?: number;
  retries?: number;
}

async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeout = REQUEST_TIMEOUT, retries = MAX_RETRIES, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Don't retry on 4xx errors (except 429 Too Many Requests)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response;
      }

      // Return success or 5xx errors for retry
      if (response.ok) {
        return response;
      }

      // 5xx errors or 429 - retry
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error as Error;

      // Don't retry on abort (timeout)
      if (error instanceof DOMException && error.name === 'AbortError') {
        clearTimeout(timeoutId);
        throw error;
      }
    }

    // Retry on failure
    if (attempt < retries) {
      // Exponential backoff
      const delay = RETRY_DELAY * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  clearTimeout(timeoutId);
  throw lastError;
}

function getAuthHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('admin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let details: unknown;
    try {
      const body = await res.json();
      details = body.error || body;
    } catch {
      details = await res.text();
    }

    throw new APIError(`Request failed: ${res.statusText}`, res.status, details);
  }
  return res.json();
}

export interface PaginationInfo {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface PostListResponse {
  items: PostList[];
  pagination: PaginationInfo;
}

// ============ Public API ============

export async function fetchPosts(filters?: {
  category_id?: number;
  tag_id?: number;
  page?: number;
  limit?: number;
}): Promise<PostListResponse> {
  const params = new URLSearchParams();
  if (filters?.category_id) params.set('category_id', String(filters.category_id));
  if (filters?.tag_id) params.set('tag_id', String(filters.tag_id));
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));

  const query = params.toString();
  const url = query ? `${API_BASE}/api/posts?${query}` : `${API_BASE}/api/posts`;

  const res = await fetchWithTimeout(url, { cache: 'no-store' });
  return handleResponse<PostListResponse>(res);
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/categories`);
  return handleResponse<Category[]>(res);
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/tags`);
  return handleResponse<Tag[]>(res);
}

export async function fetchPost(slug: string): Promise<Post> {
  const res = await fetchWithTimeout(`${API_BASE}/api/posts/${slug}`);
  return handleResponse<Post>(res);
}

export async function searchPosts(
  query: string,
  page: number = 1,
  limit: number = 10
): Promise<SearchResult> {
  const params = new URLSearchParams({
    q: query,
    page: page.toString(),
    limit: limit.toString(),
  });

  const res = await fetchWithTimeout(`${API_BASE}/api/search?${params}`);
  return handleResponse<SearchResult>(res);
}

// Re-export Comment type
export interface Comment {
  id: number;
  post_id: number;
  nickname: string;
  email: string;
  content: string;
  ip_address: string;
  created_at: string;
}

export async function fetchComments(postId: number): Promise<Comment[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/comments/post/${postId}`);
  return handleResponse<Comment[]>(res);
}

export async function createComment(
  postId: number,
  data: { nickname: string; email: string; content: string; parent_id?: number | null }
): Promise<Comment> {
  const res = await fetchWithTimeout(`${API_BASE}/api/comments/post/${postId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<Comment>(res);
}

export async function incrementViews(postId: number): Promise<Post> {
  const res = await fetchWithTimeout(`${API_BASE}/api/posts/${postId}/view`, {
    method: 'POST',
  });
  return handleResponse<Post>(res);
}

export async function incrementLikes(postId: number): Promise<Post> {
  const res = await fetchWithTimeout(`${API_BASE}/api/posts/${postId}/like`, {
    method: 'POST',
  });
  return handleResponse<Post>(res);
}

export async function fetchPopularPosts(limit: number = 5): Promise<PostList[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/posts/popular/list?limit=${limit}`);
  return handleResponse<PostList[]>(res);
}

export async function fetchRelatedPosts(postId: number, limit: number = 5): Promise<PostList[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/posts/${postId}/related?limit=${limit}`);
  return handleResponse<PostList[]>(res);
}

// ============ Admin API ============

export interface AdminPost {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  published: boolean;
  category: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface AdminPostDetail {
  id: number;
  title: string;
  slug: string;
  content: string;
  excerpt: string;
  published: boolean;
  category_id: number | null;
  tag_ids: number[];
  cover_image: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostCreate {
  title: string;
  slug: string;
  content: string;
  excerpt?: string;
  published: boolean;
  category_id?: number;
  tag_ids?: number[];
  cover_image?: string;
}

export async function fetchAdminPosts(): Promise<AdminPost[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/posts`, {
    headers: { ...getAuthHeaders() },
  });
  return handleResponse<AdminPost[]>(res);
}

export async function fetchAdminPost(id: number): Promise<AdminPostDetail> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/posts/${id}`, {
    headers: { ...getAuthHeaders() },
  });
  return handleResponse<AdminPostDetail>(res);
}

export async function createAdminPost(data: PostCreate): Promise<{ id: number }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse<{ id: number }>(res);
}

export async function updateAdminPost(
  id: number,
  data: Partial<PostCreate>
): Promise<{ id: number }> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/posts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse<{ id: number }>(res);
}

export async function deleteAdminPost(id: number): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/posts/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new APIError('Failed to delete post', res.status);
  }
}

export async function fetchAdminCategories(): Promise<Category[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/categories`, {
    headers: { ...getAuthHeaders() },
  });
  return handleResponse<Category[]>(res);
}

export async function createAdminCategory(name: string): Promise<Category> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ name }),
  });
  return handleResponse<Category>(res);
}

export async function updateAdminCategory(id: number, name: string): Promise<Category> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/categories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ name }),
  });
  return handleResponse<Category>(res);
}

export async function deleteAdminCategory(id: number): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/categories/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new APIError('Failed to delete category', res.status);
  }
}

export async function fetchAdminTags(): Promise<Tag[]> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/tags`, {
    headers: { ...getAuthHeaders() },
  });
  return handleResponse<Tag[]>(res);
}

export async function createAdminTag(name: string): Promise<Tag> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ name }),
  });
  return handleResponse<Tag>(res);
}

export async function updateAdminTag(id: number, name: string): Promise<Tag> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/tags/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ name }),
  });
  return handleResponse<Tag>(res);
}

export async function deleteAdminTag(id: number): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/tags/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new APIError('Failed to delete tag', res.status);
  }
}

// Admin comments
export interface AdminComment {
  id: number;
  post_id: number;
  post_title: string;
  nickname: string;
  email: string;
  content: string;
  ip_address: string;
  created_at: string;
}

export async function fetchAdminComments(postId?: number): Promise<AdminComment[]> {
  const query = postId ? `?post_id=${postId}` : '';
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/comments${query}`, {
    headers: { ...getAuthHeaders() },
  });
  return handleResponse<AdminComment[]>(res);
}

export async function deleteAdminComment(commentId: number): Promise<void> {
  const res = await fetchWithTimeout(`${API_BASE}/api/admin/comments/${commentId}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    throw new APIError('Failed to delete comment', res.status);
  }
}

// Admin auth
export async function adminLogin(
  username: string,
  password: string
): Promise<{ access_token: string }> {
  const formData = new URLSearchParams();
  formData.set('username', username);
  formData.set('password', password);

  const res = await fetchWithTimeout(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData,
  });
  return handleResponse<{ access_token: string }>(res);
}
