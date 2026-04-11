import { Post, PostList, Category, Tag, SearchResult } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface PostListResponse {
  items: PostList[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}

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

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch posts');
  return res.json();
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/categories`);
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/api/tags`);
  if (!res.ok) throw new Error('Failed to fetch tags');
  return res.json();
}

export async function fetchPost(slug: string): Promise<Post> {
  const res = await fetch(`${API_BASE}/api/posts/${slug}`);
  if (!res.ok) throw new Error('Failed to fetch post');
  return res.json();
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

  const res = await fetch(`/api/search?${params}`);
  if (!res.ok) {
    throw new Error('Search failed');
  }
  return res.json();
}

export interface Comment {
  id: number;
  author: string;
  content: string;
  created_at: string;
}

export async function fetchComments(postId: number): Promise<Comment[]> {
  const res = await fetch(`${API_BASE}/api/comments/post/${postId}`);
  if (!res.ok) throw new Error('Failed to fetch comments');
  return res.json();
}

export async function createComment(
  postId: number,
  data: { author: string; content: string }
): Promise<Comment> {
  const res = await fetch(`${API_BASE}/api/comments/post/${postId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create comment');
  return res.json();
}

export async function createCategory(data: { name: string }): Promise<Category> {
  const res = await fetch(`${API_BASE}/api/categories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create category');
  return res.json();
}

export async function createTag(data: { name: string }): Promise<Tag> {
  const res = await fetch(`${API_BASE}/api/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create tag');
  return res.json();
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

export async function createPost(data: PostCreate): Promise<Post> {
  const res = await fetch(`${API_BASE}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create post');
  return res.json();
}

export async function updatePost(id: number, data: Partial<PostCreate>): Promise<Post> {
  const res = await fetch(`${API_BASE}/api/posts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update post');
  return res.json();
}

export async function deletePost(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/posts/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete post');
}

export async function adminLogin(username: string, password: string): Promise<{ access_token: string }> {
  const formData = new URLSearchParams();
  formData.set('username', username);
  formData.set('password', password);

  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData,
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json();
}

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

export async function fetchAdminPosts(): Promise<AdminPost[]> {
  const res = await fetch(`${API_BASE}/api/admin/posts`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch admin posts');
  return res.json();
}

export async function fetchAdminPost(id: number): Promise<AdminPostDetail> {
  const res = await fetch(`${API_BASE}/api/admin/posts/${id}`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch admin post');
  return res.json();
}

export async function createAdminPost(data: PostCreate): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/admin/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create post');
  return res.json();
}

export async function updateAdminPost(id: number, data: Partial<PostCreate>): Promise<{ id: number }> {
  const res = await fetch(`${API_BASE}/api/admin/posts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update post');
  return res.json();
}

export async function deleteAdminPost(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/posts/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to delete post');
}

export async function fetchAdminCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/admin/categories`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch categories');
  return res.json();
}

export async function createAdminCategory(name: string): Promise<Category> {
  const res = await fetch(`${API_BASE}/api/admin/categories?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to create category');
  return res.json();
}

export async function updateAdminCategory(id: number, name: string): Promise<Category> {
  const res = await fetch(`${API_BASE}/api/admin/categories/${id}?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to update category');
  return res.json();
}

export async function deleteAdminCategory(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/categories/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to delete category');
}

export async function fetchAdminTags(): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/api/admin/tags`, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to fetch tags');
  return res.json();
}

export async function createAdminTag(name: string): Promise<Tag> {
  const res = await fetch(`${API_BASE}/api/admin/tags?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to create tag');
  return res.json();
}

export async function updateAdminTag(id: number, name: string): Promise<Tag> {
  const res = await fetch(`${API_BASE}/api/admin/tags/${id}?name=${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to update tag');
  return res.json();
}

export async function deleteAdminTag(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/tags/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) throw new Error('Failed to delete tag');
}
