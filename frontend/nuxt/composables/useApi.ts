/**
 * API client composable for Nuxt.
 * Provides typed fetch wrappers for the X-Blog backend API.
 *
 * Usage:
 *   const { data: posts } = await useApi('/api/posts');
 *   const { data: categories } = await useApi('/api/categories');
 */

export interface PaginationInfo {
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

export interface PostList {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  published: boolean;
  created_at: string;
  views: number;
  cover_image: string | null;
  category: { id: number; name: string } | null;
  tags: { id: number; name: string }[];
}

export interface PostListResponse {
  items: PostList[];
  pagination: PaginationInfo;
}

export interface Category {
  id: number;
  name: string;
}

export interface Tag {
  id: number;
  name: string;
}

/**
 * Core fetch helper that targets the backend API.
 * Uses Nuxt's useFetch with the configured API base URL.
 */
export async function useApi<T>(
  url: string,
  options: Parameters<typeof useFetch>[1] = {}
) {
  const config = useRuntimeConfig();
  const apiUrl = config.public.apiUrl;

  return useFetch<T>(url, {
    baseURL: apiUrl,
    ...options,
  });
}

/**
 * Fetch posts with optional filtering.
 */
export async function usePosts(filters?: {
  category_id?: number;
  tag_id?: number;
  page?: number;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (filters?.category_id) params.set('category_id', String(filters.category_id));
  if (filters?.tag_id) params.set('tag_id', String(filters.tag_id));
  if (filters?.page) params.set('page', String(filters.page));
  if (filters?.limit) params.set('limit', String(filters.limit));

  const query = params.toString();
  const url = query ? `/api/posts?${query}` : '/api/posts';

  return useApi<PostListResponse>(url);
}

/**
 * Fetch all categories.
 */
export async function useCategories() {
  return useApi<Category[]>('/api/categories');
}

/**
 * Fetch all tags.
 */
export async function useTags() {
  return useApi<Tag[]>('/api/tags');
}
