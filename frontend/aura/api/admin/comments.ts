import { adminAuthHeaders } from "../auth";
import type { QueryParams } from "../transport";
import { command, withQuery } from "../transport";

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

/**
 * Comments for the admin panel (auth required; paginated envelope).
 * Imperative on purpose: the page reloads from event handlers (filters,
 * paging, approve), and `await useFetch` outside setup resolves before the
 * data ref arrives (flaky empty list under load — RIL ISS-097).
 */
export function getAdminComments(
	opts: AdminCommentFilters = {},
	page = 1,
	limit = 20,
): Promise<AdminCommentListResponse> {
	const params: QueryParams = {
		post_id: opts.postId,
		is_approved: opts.isApproved,
		q: opts.q,
		date_from: opts.dateFrom,
		date_to: opts.dateTo,
		flagged: opts.flagged,
		page,
		limit,
	};
	return command<AdminCommentListResponse>(withQuery("/api/admin/comments", params), {
		headers: adminAuthHeaders(),
	});
}

/** Dismiss all reader flags on a comment (auth required). (DEC-108, TASK-166) */
export function dismissAdminCommentFlags(commentId: number): Promise<{
	comment_id: number;
	removed: number;
}> {
	return command<{ comment_id: number; removed: number }>(
		`/api/admin/comments/${commentId}/flags`,
		{
			method: "DELETE",
			headers: adminAuthHeaders(),
		},
	);
}

/** Bulk-delete selected comments (auth required). Returns the deleted count. */
export function batchDeleteAdminComments(ids: number[]): Promise<{ deleted: number }> {
	return command<{ deleted: number }>("/api/admin/comments/batch-delete", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { ids },
	});
}

/** Batch approve or reject comments (auth required). */
export function batchApproveAdminComments(ids: number[], approved: boolean): Promise<void> {
	return command<void>("/api/admin/comments/batch-approve", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { ids, approved },
	});
}

/** Delete a comment (auth required). */
export function deleteAdminComment(commentId: number): Promise<void> {
	return command<void>(`/api/admin/comments/${commentId}`, {
		method: "DELETE",
		headers: adminAuthHeaders(),
	});
}

/** Approve or reject a comment (auth required). */
export function approveAdminComment(commentId: number, approved: boolean): Promise<AdminComment> {
	return command<AdminComment>(`/api/comments/${commentId}/approve`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", ...adminAuthHeaders() },
		body: { approved },
	});
}
