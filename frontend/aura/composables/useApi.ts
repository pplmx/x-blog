/**
 * API client composable for Nuxt.
 * Provides typed fetch wrappers for the X-Blog backend API.
 *
 * Usage:
 *   const { data: posts } = await useApi('/api/posts');
 *   const { data: categories } = await useApi('/api/categories');
 */

import {
	adminAuthHeaders as getAuthHeaders,
	readerAuthHeaders as getReaderAuthHeaders,
} from "../api/auth";
import type { Category, Comment, Tag } from "../api/contracts/shared";
import { type ApiQueryOptions, query } from "../api/transport";

export type {
	Category,
	Comment,
	PaginationInfo,
	PostList,
	PostListResponse,
	SeriesBrief,
	Tag,
} from "../api/contracts/shared";

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
	options: ApiQueryOptions<T> = {},
) {
	const legacyQuery = query as <ResT>(
		path: Parameters<typeof useFetch>[0],
		queryOptions?: ApiQueryOptions<ResT>,
	) => ReturnType<typeof useFetch<ResT>>;
	return legacyQuery<T>(url, options);
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

export interface PostRevisionSummary {
	id: number;
	created_at: string;
	title: string;
	published: boolean;
}

export interface PostRevisionDetail {
	id: number;
	post_id: number;
	created_at: string;
	title: string;
	slug: string;
	content: string;
	excerpt: string | null;
	cover_image: string | null;
	category_id: number | null;
	series_id: number | null;
	series_order: number;
	publish_at: string | null;
	pinned: boolean;
	published: boolean;
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

/** List a post's saved revision history (auth required). */
export async function fetchPostRevisions(id: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<PostRevisionSummary[]>(`${apiUrl}/api/admin/posts/${id}/revisions`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Restore a stored revision as the live post (auth required). */
export async function restorePostRevision(id: number, revisionId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<AdminPostDetail>(
		`${apiUrl}/api/admin/posts/${id}/revisions/${revisionId}/restore`,
		{
			method: "POST",
			headers: { ...getAuthHeaders() },
		},
	);
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

import type { SeriesPublic } from "../api/public/series";
import type { ReaderLoginResponse } from "../api/reader/auth";

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

export interface SeriesEpisode {
	id: number;
	title: string;
	slug: string;
	series_order: number;
	published: boolean;
}

/** Fetch a series' episodes in order (admin, incl. drafts). */
export async function fetchAdminSeriesEpisodes(seriesId: number) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<SeriesEpisode[]>(`${apiUrl}/api/series/${seriesId}/episodes`, {
		headers: getAuthHeaders(),
		server: false,
	});
}

/** Reorder a series' episodes from an explicit post-id list (admin). */
export async function reorderAdminSeriesEpisodes(seriesId: number, postIds: number[]) {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<SeriesEpisode[]>(`${apiUrl}/api/series/${seriesId}/episodes/reorder`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...getAuthHeaders() },
		body: { post_ids: postIds },
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
	// Explicit generic avoids Nuxt typed-routes resolving this template string
	// through ofetch's unconstrained overload (TS2321 excessive stack depth).
	return $fetch<{ comment_id: number; removed: number }>(
		`${apiUrl}/api/admin/comments/${commentId}/flags`,
		{
			method: "DELETE",
			headers: getAuthHeaders(),
		},
	);
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

/** Current reader profile (requires reader token). */
export async function fetchCurrentReader() {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return useFetch<ReaderProfile>(`${apiUrl}/api/reader/me`, {
		headers: getReaderAuthHeaders(),
		server: false,
	});
}

/** Download the signed-in reader's portable data bundle (DEC-126/TASK-175). */
export async function fetchReaderDataExport(): Promise<Record<string, unknown>> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<Record<string, unknown>>(`${apiUrl}/api/reader/me/export`, {
		headers: getReaderAuthHeaders(),
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

// Reader notification inbox (DEC-160/TASK-192)
// ---------------------------------------------------------------------------

export interface ReaderNotification {
	id: number;
	kind: string;
	title: string;
	body?: string | null;
	url?: string | null;
	read: boolean;
	created_at?: string | null;
}

export interface ReaderNotificationListResponse {
	items: ReaderNotification[];
	total: number;
	unread: number;
	page: number;
	limit: number;
	total_pages: number;
}

/** The signed-in reader's durable notification inbox, newest first. */
export async function fetchReaderNotifications(
	page = 1,
	limit = 50,
	unreadOnly = false,
): Promise<ReaderNotificationListResponse> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	const params = new URLSearchParams({ page: String(page), limit: String(limit) });
	if (unreadOnly) params.set("unread", "true");
	return $fetch<ReaderNotificationListResponse>(
		`${apiUrl}/api/reader/me/notifications?${params.toString()}`,
		{ headers: getReaderAuthHeaders() },
	);
}

/** Mark one notification read (404 if it isn't the reader's). */
export async function markReaderNotificationRead(
	notificationId: number,
): Promise<ReaderNotification> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<ReaderNotification>(
		`${apiUrl}/api/reader/me/notifications/${notificationId}/read`,
		{ method: "POST", headers: getReaderAuthHeaders() },
	);
}

/** Mark every unread notification read; returns the count updated. */
export async function markAllReaderNotificationsRead(): Promise<{ updated: number }> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<{ updated: number }>(`${apiUrl}/api/reader/me/notifications/read-all`, {
		method: "POST",
		headers: getReaderAuthHeaders(),
	});
}

// Reader notification preferences (DEC-171/TASK-202)
// ---------------------------------------------------------------------------

/** A reader's per-kind notification opt-outs. Every true = all kinds on. */
export interface ReaderNotificationPrefs {
	new_post: boolean;
	reply: boolean;
	thread_comment: boolean;
}

/** The signed-in reader's per-kind notification preferences (all-on default). */
export async function fetchReaderNotificationPrefs(): Promise<ReaderNotificationPrefs> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<ReaderNotificationPrefs>(`${apiUrl}/api/reader/me/notification-preferences`, {
		headers: getReaderAuthHeaders(),
	});
}

/** Toggle one notification kind; returns the reader's full updated prefs. */
export async function updateReaderNotificationPref(
	kind: "new_post" | "reply" | "thread_comment",
	enabled: boolean,
): Promise<ReaderNotificationPrefs> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<ReaderNotificationPrefs>(`${apiUrl}/api/reader/me/notification-preferences`, {
		method: "PATCH",
		headers: getReaderAuthHeaders(),
		body: { kind, enabled },
	});
}

// Admin editorial calendar (DEC-162/TASK-194)
// ---------------------------------------------------------------------------

/** One post on the editorial calendar, bucketed to a grid day by the backend. */
export interface CalendarPost {
	id: number;
	title: string;
	slug: string;
	type: "published" | "scheduled" | "draft";
	date?: string | null;
	published: boolean;
	publish_at?: string | null;
	category?: string | null;
}

export interface AdminCalendarResponse {
	month: string;
	items: CalendarPost[];
	unscheduled: CalendarPost[];
}

/** Month-bucketed posts for the admin editorial calendar (auth required). */
export async function fetchAdminCalendar(month: string): Promise<AdminCalendarResponse> {
	const config = useRuntimeConfig();
	const apiUrl = config.public.apiUrl;
	return $fetch<AdminCalendarResponse>(
		`${apiUrl}/api/admin/calendar?month=${encodeURIComponent(month)}`,
		{ headers: getAuthHeaders() },
	);
}
