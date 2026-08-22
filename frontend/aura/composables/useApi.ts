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

/** Lightweight series reference embedded in a Post payload (DEC-056). */
export interface SeriesBrief {
	id: number;
	title: string;
	slug: string;
}

export interface PostList {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	snippet?: string | null;
	published: boolean;
	pinned?: boolean;
	created_at: string;
	views: number;
	likes: number;
	comment_count?: number;
	reading_time?: number;
	cover_image: string | null;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
	/** Series this post belongs to, if any (DEC-056). */
	series: SeriesBrief | null;
	/** Position within the series (author-controlled order, DEC-056). */
	series_order: number;
}

export interface PostListResponse {
	items: PostList[];
	pagination: PaginationInfo;
}

export interface Category {
	id: number;
	name: string;
	post_count?: number;
}

export interface Tag {
	id: number;
	name: string;
	post_count?: number;
}

export interface ArchiveEntry {
	year: number;
	month: number;
	count: number;
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
 * Fetch all categories as a plain awaitable promise ($fetch, not useFetch).
 * For call sites that must not turn setup async (account settings) and want a
 * guaranteed-settled result that tests can mock like any useApi helper.
 */
export async function fetchCategories(): Promise<Category[]> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<Category[]>(`${apiUrl}/api/categories`);
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
	slugOrId: string | number | (() => string | number),
	options: Parameters<typeof useFetch>[1] = {},
) {
	// Accept a getter (reactive source) so useFetch re-runs when the slug
	// changes via SPA navigation between posts, instead of pinning the first
	// value (RIL TASK-090, ISS-073).
	const url =
		typeof slugOrId === "function" ? () => `/api/posts/${slugOrId()}` : `/api/posts/${slugOrId}`;
	return useApi<Post>(url, options);
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
export async function useRelatedPosts(
	postId: number | (() => number | null | undefined),
	limit = 5,
) {
	// A reactive getter lets related posts follow the active post through SPA
	// navigation; returning null/undefined when there's no id yet makes useFetch
	// skip the request (TASK-090, ISS-073).
	const url =
		typeof postId === "function"
			? ((() => {
					const id = postId();
					return id ? `/api/posts/${id}/related` : null;
				}) as Parameters<typeof useFetch>[0])
			: `/api/posts/${postId}/related`;
	return useApi<PostList[]>(url, {
		query: { limit },
	});
}

/**
 * Adjacent linear navigation for a post, in public feed order.
 * `previous` / `next` are PostList summaries or null at the feed's ends.
 */
export interface AdjacentPosts {
	previous: PostList | null;
	next: PostList | null;
}

/**
 * Fetch the linear previous/next posts around a post.
 * Uses the backend's GET /api/posts/{post_id}/adjacent endpoint.
 */
export async function useAdjacentPosts(postId: number | (() => number | null | undefined)) {
	const url =
		typeof postId === "function"
			? ((() => {
					const id = postId();
					return id ? `/api/posts/${id}/adjacent` : null;
				}) as Parameters<typeof useFetch>[0])
			: `/api/posts/${postId}/adjacent`;
	return useApi<AdjacentPosts>(url);
}

/**
 * Public series lists/detail from the backend /api/series endpoints.
 * A series is an author-ordered group of posts (DEC-056) — see SeriesBrief
 * on PostList for the embedded reference used on post/list payloads.
 */

/** Public series summary (list view) — identity plus visible post count. */
export interface SeriesPublic {
	id: number;
	title: string;
	slug: string;
	description: string | null;
	post_count: number;
}

/** Public series detail — the series plus its ordered, visible posts. */
export interface SeriesDetail extends SeriesPublic {
	posts: PostList[];
}

/**
 * Fetch all public series (ordered by title) with their visible post counts.
 */
export async function useSeries() {
	return useApi<SeriesPublic[]>("/api/series");
}

/**
 * Fetch a single public series by slug, including its ordered visible posts.
 * Accepts a getter (reactive source) so useFetch re-runs on SPA navigation
 * between series (mirrors usePost for posts, TASK-090/ISS-073). A getter that
 * returns null/undefined (e.g. a post with no series) makes useFetch skip the
 * request (mirrors useRelatedPosts).
 */
export async function useSeriesBySlug(slug: string | (() => string | null | undefined)) {
	const url =
		typeof slug === "function"
			? ((() => {
					const s = slug();
					return s ? `/api/series/${s}` : null;
				}) as Parameters<typeof useFetch>[0])
			: `/api/series/${slug}`;
	return useApi<SeriesDetail>(url);
}

/**
 * Blog-level aggregate statistics from the backend /api/stats endpoint.
 * Exact counts (unlike deriving from a paginated post list, which the
 * backend caps at limit <= 100 and would silently undercount larger blogs).
 */
export interface BlogStats {
	total_posts: number;
	published_posts: number;
	scheduled_posts: number;
	total_categories: number;
	total_tags: number;
	total_comments: number;
	pending_comments: number;
	total_views: number;
	total_likes: number;
}

/**
 * Fetch blog aggregate statistics.
 * Uses the backend's GET /api/stats endpoint.
 */
export async function useBlogStats() {
	return useApi<BlogStats>("/api/stats");
}

/**
 * Comment type matching the backendCommentListResponse public schema. The
 * public comment list omits PII: ip_address and email are intentionally not
 * returned (RIL TASK-100, ISS-080); they exist only on the authenticated
 * admin comment list (see AdminComment).
 */
export interface Comment {
	id: number;
	post_id: number;
	parent_id: number | null;
	nickname: string;
	content: string;
	is_approved: boolean;
	/** Comment upvote count (DEC-092/TASK-158). */
	likes: number;
	created_at: string;
	/** When the reader-author last edited this comment; null/undefined = never
	 *  edited (DEC-096/TASK-160). */
	edited_at?: string | null;
	/** Verified reader identity for reader-attributed comments (DEC-062);
	 * null for anonymous free-text commenters. */
	reader: { id: number; display_name: string | null } | null;
}

export type CommentSort = "newest" | "oldest" | "likes";

/**
 * Fetch paginated comments for a post.
 * Uses the backend's GET /api/comments/post/{post_id} endpoint. `sort` lets
 * readers reorder the thread — newest (default), oldest, or most helpful
 * (likes desc) — per DEC-094/TASK-159.
 */
export async function fetchComments(
	postId: number,
	page = 1,
	limit = 20,
	sort: CommentSort = "newest",
) {
	return useApi<{
		items: Comment[];
		total: number;
		page: number;
		limit: number;
		total_pages: number;
	}>(`/api/comments/post/${postId}`, { query: { page, limit, sort } });
}

/**
 * Create a new comment for a post.
 * Uses the backend's POST /api/comments/post/{post_id} endpoint.
 */
export async function useCommentLike(commentId: number) {
	// POST /comments/{id}/like returns the updated comment with its new count.
	return useApi<Comment>(`/api/comments/${commentId}/like`, {
		method: "POST",
	});
}

/** Label for a comment flag (DEC-108, TASK-166). */
export interface CommentFlagResult {
	comment_id: number;
	flags: number;
	is_new: boolean;
}

/** Flag a comment for moderator review. Anonymous/reader, rate-limited and
 *  idempotent per (comment, source) on the backend. */
export async function flagComment(commentId: number): Promise<CommentFlagResult> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<CommentFlagResult>(`${apiUrl}/api/comments/${commentId}/flag`, {
		method: "POST",
	});
}

export async function createComment(
	postId: number,
	data: {
		nickname: string;
		email: string;
		content: string;
		parent_id?: number | null;
		website?: string;
	},
) {
	// A signed-in reader comments under their account: send the reader JWT so
	// the backend stamps identity from the token (client-supplied nickname is
	// ignored then). Empty headers (no reader_token) keeps anonymous comments
	// working unchanged. (DEC-062, TASK-136)
	const headers = getReaderAuthHeaders();
	return useApi<Comment>(`/api/comments/post/${postId}`, {
		method: "POST",
		body: data,
		...(Object.keys(headers).length ? { headers } : {}),
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
	category_id: number | null;
	comment_count: number;
	tags: string[];
	/** Series membership (DEC-056/TASK-123) — null when the post is standalone. */
	series_id: number | null;
	series_order: number;
	series_title: string | null;
	series_slug: string | null;
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
	/** Series membership (DEC-056/TASK-123) — null when the post is standalone. */
	series_id: number | null;
	series_order: number;
	series_title: string | null;
	series_slug: string | null;
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
	/** Series membership (DEC-056/TASK-123); undefined = standalone post. */
	series_id?: number;
	series_order?: number;
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
	/** Distinct reader flags (DEC-108, TASK-166). */
	flag_count?: number;
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

/** A runtime site setting (DEC-100, TASK-162). `value` is a canonical string
 *  ("true"/"false" for boolean settings). */
export interface SiteSetting {
	key: string;
	value: string;
}

/** Read a runtime site setting (admin auth). */
export async function fetchSiteSetting(key: string) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<SiteSetting>(`${apiUrl}/api/admin/settings/${key}`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Persist a runtime site setting (admin auth). */
export async function updateSiteSetting(key: string, value: string) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<SiteSetting>(`${apiUrl}/api/admin/settings/${key}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { value },
	});
}

// ============================================================================
// Admin series (DEC-056/TASK-123)
//
// Series write endpoints live under /api/series (POST/PUT/DELETE are admin-
// gated with get_current_admin on the backend), and the list endpoint is the
// same one the public /series index uses. Admin helpers reuse those paths with
// auth headers so a manager can create/rename/reorder/delete series.
// ============================================================================

export interface AdminSeries extends SeriesPublic {
	description: string | null;
	post_count: number;
}

export interface AdminSeriesInput {
	title: string;
	slug: string;
	description: string | null;
}

/** Fetch all series (admin view — same payload as the public list). */
export async function fetchAdminSeries() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminSeries[]>(`${apiUrl}/api/series`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Create a series (auth required). */
export async function createAdminSeries(data: AdminSeriesInput) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminSeries>(`${apiUrl}/api/series`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: data,
	});
}

/** Update a series (auth required). */
export async function updateAdminSeries(id: number, data: Partial<AdminSeriesInput>) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminSeries>(`${apiUrl}/api/series/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: data,
	});
}

/** Delete a series — unlinks its posts, which keep existing (auth required). */
export async function deleteAdminSeries(id: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch(`${apiUrl}/api/series/${id}`, {
		method: "DELETE",
		headers: getAuthHeaders(),
	});
}

// ============================================================================
// Admin users
// ============================================================================

export interface AdminUser {
	id: number;
	username: string;
	role: "superuser" | "editor";
	is_superuser: boolean;
}

export interface CreateAdminUserInput {
	username: string;
	password: string;
}

/** Fetch the current admin's profile (id, username, role) — drives role-aware UI. */
export async function fetchCurrentAdmin() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminUser>(`${apiUrl}/api/admin/me`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Fetch all admin users (auth required). */
export async function fetchAdminUsers() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminUser[]>(`${apiUrl}/api/admin/users`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Create an admin user (auth required). */
export async function createAdminUser(data: CreateAdminUserInput) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminUser>(`${apiUrl}/api/admin/users`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: data,
	});
}

/** Delete an admin user (auth required). */
export async function deleteAdminUser(id: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch(`${apiUrl}/api/admin/users/${id}`, {
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

export interface AdminCommentFilters {
	postId?: number;
	isApproved?: boolean;
	q?: string;
	dateFrom?: string;
	dateTo?: string;
	flagged?: boolean;
}

export async function fetchAdminComments(
	opts: AdminCommentFilters = {},
	page = 1,
	limit = 20,
): Promise<AdminCommentListResponse> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	const query = new URLSearchParams();
	if (opts.postId) query.set("post_id", String(opts.postId));
	if (opts.isApproved !== undefined) query.set("is_approved", String(opts.isApproved));
	if (opts.q) query.set("q", opts.q);
	if (opts.dateFrom) query.set("date_from", opts.dateFrom);
	if (opts.dateTo) query.set("date_to", opts.dateTo);
	if (opts.flagged !== undefined) query.set("flagged", String(opts.flagged));
	query.set("page", String(page));
	query.set("limit", String(limit));
	// $fetch (not useFetch): the admin comments page reloads imperatively
	// (filters/paging/approve) from event handlers, and `await useFetch` in a
	// non-setup context resolves before the data ref arrives (flaky empty list
	// under load — RIL ISS-097). $fetch awaits the real response. (DEC-070-era
	// pattern, same as the reader my-comments helpers.)
	return $fetch<AdminCommentListResponse>(`${apiUrl}/api/admin/comments?${query}`, {
		headers: getAuthHeaders(),
	});
}

/** Dismiss all reader flags on a comment (auth required). (DEC-108, TASK-166) */
export async function dismissAdminCommentFlags(commentId: number): Promise<{
	comment_id: number;
	removed: number;
}> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch(`${apiUrl}/api/admin/comments/${commentId}/flags`, {
		method: "DELETE",
		headers: getAuthHeaders(),
	});
}

/** Bulk-delete selected comments (auth required). Returns the deleted count. */
export async function batchDeleteAdminComment(ids: number[]): Promise<{ deleted: number }> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<{ deleted: number }>(`${apiUrl}/api/admin/comments/batch-delete`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { ids },
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

/** Push notification body accepted by POST /api/push/notify (DEC-055). */
export interface PushNotifyPayload {
	title: string;
	body: string;
	url: string;
}

/** Broadcast a notification to every push subscriber (superuser only). */
export async function notifyPushSubscribers(payload: PushNotifyPayload) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<{ total: number; sent: number; failed: number; removed: number }>(
		`${apiUrl}/api/push/notify`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", ...getAuthHeaders() },
			body: payload,
			server: false,
		},
	);
}

// ---------------------------------------------------------------------------
// Reader account + cloud-synced bookmarks (DEC-059, TASK-131/132)
// ---------------------------------------------------------------------------

export interface ReaderProfile {
	id: number;
	email: string;
	display_name: string | null;
	created_at: string | null;
}

export interface ReaderLoginResponse {
	access_token: string;
	token_type: string;
	reader: ReaderProfile;
}

/** A bookmarked post as serialized by GET /api/reader/me/bookmarks (TASK-132).
 * Mirrors the localStorage `Bookmark` shape (useBookmarks.ts) so both
 * serializations merge transparently on the client. */
export interface ReaderBookmarkItem {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	cover_image: string | null;
	created_at: string | null;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
}

export interface ReaderBookmarkListResponse {
	items: ReaderBookmarkItem[];
	total: number;
}

/** Authorization header from the reader token (distinct store from admin). */
function getReaderAuthHeaders(): HeadersInit {
	if (
		typeof window === "undefined" ||
		typeof localStorage === "undefined" ||
		typeof localStorage.getItem !== "function"
	) {
		return {};
	}
	const token = localStorage.getItem("reader_token");
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Reader self-registration (auto-login on the backend). */
export async function readerRegister(body: {
	email: string;
	password: string;
	display_name?: string;
}) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<ReaderLoginResponse>(`${apiUrl}/api/reader/register`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		server: false,
	});
}

/** Reader login (email + password). */
export async function readerLogin(body: { email: string; password: string }) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<ReaderLoginResponse>(`${apiUrl}/api/reader/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
		server: false,
	});
}

/** Current reader profile (requires reader token). */
export async function fetchCurrentReader() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<ReaderProfile>(`${apiUrl}/api/reader/me`, {
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Cloud-synced bookmarks list (requires reader token). */
export async function fetchReaderBookmarks() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<ReaderBookmarkListResponse>(`${apiUrl}/api/reader/me/bookmarks`, {
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Save a bookmark. Returns 201 (new) / 200 (already existed) — idempotent. */
export async function addReaderBookmark(postId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<{ post_id: number }>(`${apiUrl}/api/reader/me/bookmarks/${postId}`, {
		method: "PUT",
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Remove a bookmark (204 no-op if absent). */
export async function removeReaderBookmark(postId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<null>(`${apiUrl}/api/reader/me/bookmarks/${postId}`, {
		method: "DELETE",
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** One history item — a viewed post summary plus when it was last read. */
export interface ReaderHistoryItem {
	id: number;
	title: string;
	slug: string;
	excerpt?: string | null;
	viewed_at?: string | null;
}

export interface ReaderHistoryListResponse {
	items: ReaderHistoryItem[];
	total: number;
	page: number;
	limit: number;
	total_pages: number;
}

/** Server-backed reading history list, newest-first (requires reader token). */
export async function fetchReaderHistory(page = 1, limit = 50) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<ReaderHistoryListResponse>(
		`${apiUrl}/api/reader/me/history?page=${page}&limit=${limit}`,
		{
			headers: getReaderAuthHeaders(),
			server: false,
		},
	);
}

/** Record a view on a post (idempotent upsert; requires reader token). */
export async function recordReaderHistory(postId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<{ post_id: number; already_existed: boolean }>(
		`${apiUrl}/api/reader/me/history/${postId}`,
		{
			method: "POST",
			headers: getReaderAuthHeaders(),
			server: false,
		},
	);
}

export interface ReaderHistoryStats {
	total_posts: number;
	total_reading_minutes: number;
	last_viewed_at?: string | null;
	recent: ReaderHistoryItem[];
}

/** Reader reading-summary stats derived from their history (requires reader token). */
export async function fetchReaderHistoryStats() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<ReaderHistoryStats>(`${apiUrl}/api/reader/me/history/stats`, {
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Clear the reader's entire reading history (requires reader token). */
export async function clearReaderHistory() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<null>(`${apiUrl}/api/reader/me/history`, {
		method: "DELETE",
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Moderation status of a reader's own comment (DEC-066, TASK-139). */
export type MyCommentStatus = "pending" | "approved" | "rejected";

/** One of the caller's own comments, its moderation status, and the post it
 * was left on (for navigation back to the thread). */
export interface MyComment extends Comment {
	status: MyCommentStatus;
	post: { id: number; title: string; slug: string } | null;
}

export interface MyCommentListResponse {
	items: MyComment[];
	total: number;
	/** Pagination metadata (DEC-102, TASK-163). Optional for readers of older
	 *  responses; the page defaults missing values. */
	page?: number;
	limit?: number;
	total_pages?: number;
}

/** Valid status filters for a reader's own comment history (DEC-102, TASK-163). */
export type MyCommentStatusFilter = "all" | MyCommentStatus;

/**
 * The signed-in reader's own comment history across statuses (401 when no
 * token). Uses $fetch (not useFetch) deliberately: these are imperative
 * client-only reads (invoked from onMounted / after delete), and useFetch in a
 * non-setup context can resolve before the data ref arrives (flaky empty
 * list). $fetch awaits the real response. (DEC-066, TASK-139/140)
 */
export async function fetchMyComments(
	status: MyCommentStatusFilter = "all",
	page = 1,
	limit = 20,
): Promise<MyCommentListResponse> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<MyCommentListResponse>(`${apiUrl}/api/reader/me/comments`, {
		query: { status, page, limit },
		headers: getReaderAuthHeaders(),
	});
}

/** Delete one of the reader's own comments (204; 404 for another's / unknown). */
export async function deleteMyComment(commentId: number): Promise<void> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	await $fetch(`${apiUrl}/api/reader/me/comments/${commentId}`, {
		method: "DELETE",
		headers: getReaderAuthHeaders(),
	});
}

/** Edit one of the reader's own comments (returns the updated CommentPublic;
 *  404 for another's / unknown). (DEC-096, TASK-160) */
export async function editMyComment(commentId: number, content: string): Promise<Comment> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<Comment>(`${apiUrl}/api/reader/me/comments/${commentId}`, {
		method: "PATCH",
		headers: getReaderAuthHeaders(),
		body: { content },
	});
}

/* ---------------------------------------------------------------------------
 * Comment-thread subscriptions (DEC-078, TASK-150): follow a post's discussion
 * and get a push when a new comment is approved.
 * ------------------------------------------------------------------------- */

/** Whether the signed-in reader follows a post's comment thread. */
export interface PostSubscriptionStatus {
	post_id: number;
	subscribed: boolean;
}

/** The reader's followed threads — same navigation-list shape as the bookmark
 * list (title/slug/cover/taxonomy, no content dump). */
export interface SubscribedThreadItem {
	id: number;
	title: string;
	slug: string;
	excerpt: string | null;
	cover_image: string | null;
	category: { id: number; name: string } | null;
	tags: { id: number; name: string }[];
}

export interface SubscribedThreadListResponse {
	items: SubscribedThreadItem[];
	total: number;
}

/** Follow status for one post (anonymous readers get subscribed: false). */
export async function fetchPostSubscription(postId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<PostSubscriptionStatus>(`${apiUrl}/api/posts/${postId}/subscription`, {
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Follow a post's comment thread (idempotent; reader token required). */
export async function subscribeToPostThread(postId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<PostSubscriptionStatus>(`${apiUrl}/api/posts/${postId}/subscription`, {
		method: "PUT",
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Unfollow a post's comment thread (idempotent 204). */
export async function unsubscribeFromPostThread(postId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<null>(`${apiUrl}/api/posts/${postId}/subscription`, {
		method: "DELETE",
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** The followed comment threads for the account page (imperative $fetch). */
export async function fetchMyPostSubscriptions(): Promise<SubscribedThreadListResponse> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<SubscribedThreadListResponse>(`${apiUrl}/api/reader/me/post-subscriptions`, {
		headers: getReaderAuthHeaders(),
	});
}

/* ---------------------------------------------------------------------------
 * Reader account self-service (DEC-067, TASK-141/142): profile + password +
 * push-device management.
 * ------------------------------------------------------------------------- */

/** Update the reader's own profile (currently display_name; email immutable). */
export async function updateMyProfile(body: { display_name?: string }): Promise<ReaderProfile> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<ReaderProfile>(`${apiUrl}/api/reader/me`, {
		method: "PATCH",
		headers: { ...getReaderAuthHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Change the reader's password (verifies current). Returns a fresh session
 * whose token supersedes the stored one (token_version bump). */
export async function changeMyPassword(body: {
	current_password: string;
	new_password: string;
}): Promise<ReaderLoginResponse> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<ReaderLoginResponse>(`${apiUrl}/api/reader/me/password`, {
		method: "POST",
		headers: { ...getReaderAuthHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Permanently delete the reader's own account (204 on success; 401 when the
 *  password is wrong). Past comments are anonymized, not deleted. (DEC-106) */
export async function deleteReaderAccount(password: string): Promise<void> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	await $fetch(`${apiUrl}/api/reader/me/account`, {
		method: "DELETE",
		headers: { ...getReaderAuthHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({ password }),
	});
}

/** One push subscription bound to the reader account (device-management view;
 * encryption keys are never returned). */
export interface ReaderPushSubscription {
	id: number;
	endpoint: string;
	created_at: string | null;
	want_new_posts: boolean;
	new_post_category_id: number | null;
}

export interface ReaderPushSubscriptionListResponse {
	items: ReaderPushSubscription[];
	total: number;
}

/** The reader's push subscriptions (devices registered for notifications). */
export async function fetchMyPushSubscriptions(): Promise<ReaderPushSubscriptionListResponse> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<ReaderPushSubscriptionListResponse>(`${apiUrl}/api/reader/me/push-subscriptions`, {
		headers: getReaderAuthHeaders(),
	});
}

/** Revoke one of the reader's push subscriptions (204; 404 for another's). */
export async function revokeMyPushSubscription(subscriptionId: number): Promise<void> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	await $fetch(`${apiUrl}/api/reader/me/push-subscriptions/${subscriptionId}`, {
		method: "DELETE",
		headers: getReaderAuthHeaders(),
	});
}

/**
 * Update the new-post notification prefs on one of the reader's devices
 * (DEC-076/TASK-147). `new_post_category_id` null = all new posts.
 */
export async function updateMyPushSubscriptionPrefs(
	subscriptionId: number,
	prefs: { want_new_posts: boolean; new_post_category_id: number | null },
): Promise<ReaderPushSubscription> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<ReaderPushSubscription>(
		`${apiUrl}/api/reader/me/push-subscriptions/${subscriptionId}`,
		{
			method: "PATCH",
			headers: getReaderAuthHeaders(),
			body: prefs,
		},
	);
}
