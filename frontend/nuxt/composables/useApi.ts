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

export interface Post extends PostList {
  content: string;
  likes: number;
  updated_at: string;
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

/**
 * Fetch a single post by slug or numeric ID.
 * Uses the backend's /api/posts/{slug_or_id} endpoint which accepts
 * either a slug string or a numeric ID.
 */
export async function usePost(
  slugOrId: string | number,
  options: Parameters<typeof useFetch>[1] = {},
) {
  return useApi<Post>(`/api/posts/${slugOrId}`, options);
}

/**
 * Search posts by keyword.
 * Uses the backend's /api/search endpoint.
 * Returns the same shape as PostListResponse.
 */
export async function useSearch(
  query: string,
  page: number = 1,
  limit: number = 10,
) {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("page", String(page));
  params.set("limit", String(limit));

  const url = `/api/search?${params.toString()}`;
  return useApi<PostListResponse>(url);
}

/**
 * Increment the view count for a post.
 * Uses the backend's POST /api/posts/{post_id}/view endpoint.
 */
export async function usePostView(postId: number) {
  return useApi<Post>(`/api/posts/${postId}/view`, {
    method: "POST",
  });
}

/**
 * Increment the like count for a post.
 * Uses the backend's POST /api/posts/{post_id}/like endpoint.
 */
export async function usePostLike(postId: number) {
  return useApi<Post>(`/api/posts/${postId}/like`, {
    method: "POST",
  });
}

/**
 * Fetch the most popular posts by view count.
 * Uses the backend's GET /api/posts/popular/list endpoint.
 */
export async function usePopularPosts(limit: number = 5) {
  return useApi<PostList[]>("/api/posts/popular/list", {
    query: { limit },
  });
}

/**
 * Fetch related posts for a given post.
 * Uses the backend's GET /api/posts/{post_id}/related endpoint.
 * Returns a list of related posts based on category and tags.
 */
export async function useRelatedPosts(postId: number, limit: number = 5) {
  return useApi<PostList[]>(`/api/posts/${postId}/related`, {
    query: { limit },
  });
}
