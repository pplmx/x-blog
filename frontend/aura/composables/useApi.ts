/**
 * API client composable for Nuxt.
 * Provides typed fetch wrappers for the X-Blog backend API.
 *
 * Usage:
 *   const { data: posts } = await useApi('/api/posts');
 *   const { data: categories } = await useApi('/api/categories');
 */

import { adminAuthHeaders as getAuthHeaders } from "../api/auth";
import type { Category } from "../api/contracts/shared";
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
