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

export interface AdminPostsQuery {
	q?: string;
	status?: string;
	skip?: number;
	limit?: number;
}

/** Posts for the admin panel with search/filter/pagination (reactive). */
export function useAdminPosts(params: AdminPostsQuery = {}) {
	return query<AdminPostListResponse>(withQuery("/api/admin/posts", params as QueryParams), {
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
