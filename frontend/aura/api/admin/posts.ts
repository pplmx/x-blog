import { type Ref, unref } from "vue";
import { adminAuthHeaders } from "../auth";
import type { QueryParams } from "../transport";
import { command, query, withQuery } from "../transport";

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
	/** Per-post comments toggle (round 351): false closes a post's comments
	 *  without removing existing ones or disabling comments site-wide. */
	comments_enabled: boolean;
	publish_at: string | null;
	cover_image: string | null;
	category_id: number | null;
	/** Series membership (DEC-056/TASK-123) — null when the post is standalone. */
	series_id: number | null;
	series_order: number;
	series_title: string | null;
	series_slug: string | null;
	/** Author attribution (DEC-359/TASK-406): current author for the picker's
	 *  pre-selection; null on pre-attribution posts. */
	author_id?: number | null;
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
	/** Round 351: close a post's comments at create/update (default open). */
	comments_enabled?: boolean;
	publish_at?: string | null;
	/** null (not just absent) clears the category on update — the backend's
	 *  exclude_unset contract distinguishes "unchanged" from "cleared". */
	category_id?: number | null;
	/** Picker-selected tag ids; the backend UPDATE schema takes these
	 *  (`tag_ids`, schemas.py PostUpdate). The CREATE schema instead takes tag
	 *  NAMES (`tags`) — the editor translates ids→names before POSTing. */
	tag_ids?: number[];
	/** Create-path tag names (backend schemas.py PostCreate). */
	tags?: string[];
	cover_image?: string;
	/** Series membership; explicit null (not just absent) removes the post
	 *  from the series, same exclude_unset distinction as category_id. */
	series_id?: number | null;
	series_order?: number;
	/** Author attribution (DEC-359/TASK-406): the admin the post is attributed
	 *  to. Omitted/absent on update means "don't change"; the editor always
	 *  sends an explicit id (the backend defaults create to the writing admin
	 *  and never clears an author). */
	author_id?: number | null;
}

export interface AdminPostsQuery {
	q?: string;
	status?: string;
	skip?: number;
	limit?: number;
}

type Getter<T> = () => T;
type MaybeGetter<T> = T | Getter<T> | Ref<T>;

/**
 * Build a reactive listing path for /api/admin/posts.
 *
 * `params` may be a plain object, a ref, or a getter. Returning a getter
 * (rather than a static string) means useFetch re-runs when the params change
 * — so search/status/pagination edits trigger a real refetch instead of a
 * refresh() that re-pulls the original snapshot URL (deep-dive finding,
 * mached by the media page's useAdminMedia pattern).
 */
function postsListPath(params: MaybeGetter<AdminPostsQuery>): string | Getter<string> {
	if (typeof params === "function")
		return () => withQuery("/api/admin/posts", params() as QueryParams);
	return () => withQuery("/api/admin/posts", unref(params) as QueryParams);
}

/** Posts for the admin panel with search/filter/pagination (reactive). */
export function useAdminPosts(params: MaybeGetter<AdminPostsQuery> = {}) {
	return query<AdminPostListResponse>(postsListPath(params), {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** A single post for editing (reactive setup read). */
export function useAdminPost(id: number) {
	return query<AdminPostDetail>(`/api/admin/posts/${id}`, {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** A single post for one-off loads (e.g. an onMounted preview). */
export function getAdminPost(id: number): Promise<AdminPostDetail> {
	return command<AdminPostDetail>(`/api/admin/posts/${id}`, {
		headers: adminAuthHeaders(),
	});
}

/** A post's saved revision history (reactive setup read). */
export function usePostRevisions(id: number) {
	return query<PostRevisionSummary[]>(`/api/admin/posts/${id}/revisions`, {
		headers: adminAuthHeaders(),
		server: false,
	});
}

/** A post's saved revision history, imperatively (lazy-load handlers). */
export function getPostRevisions(id: number): Promise<PostRevisionSummary[]> {
	return command<PostRevisionSummary[]>(`/api/admin/posts/${id}/revisions`, {
		headers: adminAuthHeaders(),
	});
}

/** Per-post daily reading series for the editor sparkline (DEC-287/TASK-372). */
export interface PostViewsTrend {
	post_id: number;
	days: number;
	total: number;
	series: Array<{ day: string; views: number }>;
}

/** The last `days` days of views for one post (admin only). */
export function getAdminPostViewsTrend(postId: number, days: number = 30): Promise<PostViewsTrend> {
	return command<PostViewsTrend>(`/api/admin/stats/views/posts/${postId}?days=${days}`, {
		headers: adminAuthHeaders(),
	});
}

/** Restore a stored revision as the live post (auth required). */
export function restorePostRevision(id: number, revisionId: number): Promise<AdminPostDetail> {
	return command<AdminPostDetail>(`/api/admin/posts/${id}/revisions/${revisionId}/restore`, {
		method: "POST",
		headers: adminAuthHeaders(),
	});
}

/** Create a new post (auth required). */
export function createAdminPost(data: PostCreate): Promise<{ id: number }> {
	return command<{ id: number }>("/api/admin/posts", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: data,
	});
}

/** Update an existing post (auth required). */
export function updateAdminPost(id: number, data: Partial<PostCreate>): Promise<{ id: number }> {
	return command<{ id: number }>(`/api/admin/posts/${id}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: data,
	});
}

/** Delete a post (auth required). */
export function deleteAdminPost(id: number): Promise<void> {
	return command<void>(`/api/admin/posts/${id}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}

/** Duplicate a post into a fresh draft (round 349): same content + taxonomy,
 *  a new unique slug, publication metadata cleared. Returns the new draft's
 *  id so the list can jump straight into the editor. */
export function cloneAdminPost(id: number): Promise<{ id: number }> {
	return command<{ id: number }>(`/api/admin/posts/${id}/clone`, {
		method: "POST",
		headers: adminAuthHeaders(),
	});
}
