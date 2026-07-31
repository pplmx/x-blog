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
	snippet?: string | null;
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
 *
 * `url` may be a plain string, a ref, or a getter. When it is reactive,
 * useFetch re-runs automatically on change (used by search/tags pages to
 * refetch when route query params change without navigation).
 */
export async function useApi<T>(
	url: Parameters<typeof useFetch>[0],
	options: Parameters<typeof useFetch>[1] = {},
) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;

	return useFetch<T>(
		url as string,
		{
			baseURL: apiUrl,
			...((options as Record<string, unknown>) ?? {}),
		} as never,
	);
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
	if (filters?.category_id) params.set("category_id", String(filters.category_id));
	if (filters?.tag_id) params.set("tag_id", String(filters.tag_id));
	if (filters?.page) params.set("page", String(filters.page));
	if (filters?.limit) params.set("limit", String(filters.limit));

	const query = params.toString();
	const url = query ? `/api/posts?${query}` : "/api/posts";

	return useApi<PostListResponse>(url);
}

/**
 * Fetch all categories.
 */
export async function useCategories() {
	return useApi<Category[]>("/api/categories");
}

/**
 * Fetch all tags.
 */
export async function useTags() {
	return useApi<Tag[]>("/api/tags");
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
export async function useSearch(query: string, page = 1, limit = 10) {
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
export async function usePopularPosts(limit = 5) {
	return useApi<PostList[]>("/api/posts/popular/list", {
		query: { limit },
	});
}

/**
 * Fetch related posts for a given post.
 * Uses the backend's GET /api/posts/{post_id}/related endpoint.
 * Returns a list of related posts based on category and tags.
 */
export async function useRelatedPosts(postId: number, limit = 5) {
	return useApi<PostList[]>(`/api/posts/${postId}/related`, {
		query: { limit },
	});
}

/**
 * Comment type matching the backend Comment schema.
 */
export interface Comment {
	id: number;
	post_id: number;
	parent_id: number | null;
	nickname: string;
	email: string;
	content: string;
	is_approved: boolean;
	ip_address: string;
	created_at: string;
}

/**
 * Fetch paginated comments for a post.
 * Uses the backend's GET /api/comments/post/{post_id} endpoint.
 */
export async function fetchComments(postId: number, page = 1, limit = 20) {
	return useApi<{
		items: Comment[];
		total: number;
		page: number;
		limit: number;
		total_pages: number;
	}>(`/api/comments/post/${postId}`, { query: { page, limit } });
}

/**
 * Create a new comment for a post.
 * Uses the backend's POST /api/comments/post/{post_id} endpoint.
 */
export async function createComment(
	postId: number,
	data: {
		nickname: string;
		email: string;
		content: string;
		parent_id?: number | null;
	},
) {
	return useApi<Comment>(`/api/comments/post/${postId}`, {
		method: "POST",
		body: data,
	});
}

// ============================================================================
// Admin API
// ============================================================================

export interface AdminPost {
	id: number;
	title: string;
	slug: string;
	published: boolean;
	pinned: boolean;
	publish_at: string | null;
	views: number;
	cover_image: string | null;
	category: string | null;
	tags: string[];
	created_at: string;
	updated_at: string;
}

export interface AdminPostListResponse {
	items: AdminPost[];
	pagination: {
		total: number;
		skip: number;
		limit: number;
	};
}

export interface AdminPostDetail {
	id: number;
	title: string;
	slug: string;
	content: string;
	excerpt: string;
	published: boolean;
	pinned: boolean;
	publish_at: string | null;
	cover_image: string | null;
	category_id: number | null;
	tag_ids: number[];
	created_at: string;
	updated_at: string;
}

export interface PostCreate {
	title: string;
	slug: string;
	content: string;
	excerpt?: string;
	published: boolean;
	pinned?: boolean;
	publish_at?: string | null;
	category_id?: number;
	tag_ids?: number[];
	cover_image?: string;
}

export interface AdminComment {
	id: number;
	post_id: number;
	post_title: string;
	nickname: string;
	email: string;
	content: string;
	ip_address: string;
	is_approved: boolean;
	created_at: string;
}

/** Get auth headers from localStorage (admin token). */
function getAuthHeaders(): HeadersInit {
	// typeof window guards SSR (see useAdminAuth.hasLocalStorage): a partial
	// localStorage global on Node must not crash admin fetches during SSR.
	if (
		typeof window === "undefined" ||
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return {};
	}
	const token = localStorage.getItem("admin_token");
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Fetch posts for admin panel with search, filter, pagination. */
export async function fetchAdminPosts(params?: {
	q?: string;
	status?: string;
	skip?: number;
	limit?: number;
}) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	const query = new URLSearchParams();
	if (params?.q) query.set("q", params.q);
	if (params?.status) query.set("status", params.status);
	if (params?.skip) query.set("skip", String(params.skip));
	if (params?.limit) query.set("limit", String(params.limit));
	const qs = query.toString();
	return useFetch<AdminPostListResponse>(`${apiUrl}/api/admin/posts${qs ? `?${qs}` : ""}`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Fetch a single post by ID for editing (auth required). */
export async function fetchAdminPost(id: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminPostDetail>(`${apiUrl}/api/admin/posts/${id}`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Create a new post (auth required). */
export async function createAdminPost(data: PostCreate) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<{ id: number }>(`${apiUrl}/api/admin/posts`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: data,
	});
}

/** Update an existing post (auth required). */
export async function updateAdminPost(id: number, data: Partial<PostCreate>) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<{ id: number }>(`${apiUrl}/api/admin/posts/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: data,
	});
}

/** Delete a post (auth required). */
export async function deleteAdminPost(id: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch(`${apiUrl}/api/admin/posts/${id}`, {
		method: "DELETE",
		headers: getAuthHeaders(),
	});
}

/** Fetch all categories (admin, auth required). */
export async function fetchAdminCategories() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<Category[]>(`${apiUrl}/api/admin/categories`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Create a category (auth required). */
export async function createAdminCategory(name: string) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<Category>(`${apiUrl}/api/admin/categories`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { name },
	});
}

/** Update a category (auth required). */
export async function updateAdminCategory(id: number, name: string) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<Category>(`${apiUrl}/api/admin/categories/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { name },
	});
}

/** Delete a category (auth required). */
export async function deleteAdminCategory(id: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch(`${apiUrl}/api/admin/categories/${id}`, {
		method: "DELETE",
		headers: getAuthHeaders(),
	});
}

/** Fetch all tags (admin, auth required). */
export async function fetchAdminTags() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<Tag[]>(`${apiUrl}/api/admin/tags`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Create a tag (auth required). */
export async function createAdminTag(name: string) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<Tag>(`${apiUrl}/api/admin/tags`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { name },
	});
}

/** Update a tag (auth required). */
export async function updateAdminTag(id: number, name: string) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<Tag>(`${apiUrl}/api/admin/tags/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { name },
	});
}

/** Delete a tag (auth required). */
export async function deleteAdminTag(id: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch(`${apiUrl}/api/admin/tags/${id}`, {
		method: "DELETE",
		headers: getAuthHeaders(),
	});
}

/** Fetch comments for admin panel (auth required, paginated envelope). */
export interface AdminCommentListResponse {
	items: AdminComment[];
	pagination: {
		total: number;
		page: number;
		limit: number;
		total_pages: number;
	};
}

export async function fetchAdminComments(postId?: number, page = 1, limit = 20) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	const query = new URLSearchParams();
	if (postId) query.set("post_id", String(postId));
	query.set("page", String(page));
	query.set("limit", String(limit));
	return useFetch<AdminCommentListResponse>(`${apiUrl}/api/admin/comments?${query}`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Batch approve or reject comments (auth required). */
export async function batchApproveAdminComment(ids: number[], approved: boolean) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch(`${apiUrl}/api/admin/comments/batch-approve`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { ids, approved },
	});
}

/** Delete a comment (auth required). */
export async function deleteAdminComment(commentId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch(`${apiUrl}/api/admin/comments/${commentId}`, {
		method: "DELETE",
		headers: getAuthHeaders(),
	});
}

/** Approve or reject a comment (auth required). */
export async function approveAdminComment(commentId: number, approved: boolean) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminComment>(`${apiUrl}/api/comments/${commentId}/approve`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { approved },
	});
}

/** Admin login — returns access token. */
export async function adminLogin(username: string, password: string) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	const formData = new URLSearchParams();
	formData.set("username", username);
	formData.set("password", password);

	return useFetch<{ access_token: string }>(`${apiUrl}/api/admin/login`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: formData,
	});
}
