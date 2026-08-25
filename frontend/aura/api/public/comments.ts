import { readerAuthHeaders } from "../auth";
import type { Comment } from "../contracts/shared";
import { command, query } from "../transport";

export type CommentSort = "newest" | "oldest" | "likes";

/** Paginated comment thread for a post (GET /api/comments/post/{post_id}). */
export interface CommentListResponse {
	items: Comment[];
	total: number;
	page: number;
	limit: number;
	total_pages: number;
}

/** Label for a comment flag (DEC-108, TASK-166). */
export interface CommentFlagResult {
	comment_id: number;
	flags: number;
	is_new: boolean;
}

/**
 * Reactive comment thread for setup usage.
 * Uses the backend's GET /api/comments/post/{post_id} endpoint. `sort` lets
 * readers reorder the thread — newest (default), oldest, or most helpful
 * (likes desc) — per DEC-094/TASK-159.
 */
export function useComments(postId: number, page = 1, limit = 20, sort: CommentSort = "newest") {
	return query<CommentListResponse>(`/api/comments/post/${postId}`, {
		query: { page, limit, sort },
	});
}

/**
 * Imperative comment page fetch for handlers (re-fetch after submit,
 * pagination, sort change) that need the settled response directly.
 */
export function getComments(
	postId: number,
	page = 1,
	limit = 20,
	sort: CommentSort = "newest",
): Promise<CommentListResponse> {
	return command<CommentListResponse>(`/api/comments/post/${postId}`, {
		query: { page, limit, sort },
	});
}

/**
 * Like a comment (POST /api/comments/{id}/like). Fire-and-forget from the
 * click handler, so it must run through the imperative `command` seam —
 * `useFetch` never executes outside a setup/suspense context. (ISS-111)
 */
export function likeComment(commentId: number): Promise<Comment> {
	return command<Comment>(`/api/comments/${commentId}/like`, { method: "POST" });
}

/** Flag a comment for moderator review. Anonymous/reader, rate-limited and
 *  idempotent per (comment, source) on the backend. */
export function flagComment(commentId: number): Promise<CommentFlagResult> {
	return command<CommentFlagResult>(`/api/comments/${commentId}/flag`, { method: "POST" });
}

/**
 * Create a comment for a post (POST /api/comments/post/{post_id}).
 * A signed-in reader comments under their account: the reader JWT is sent so
 * the backend stamps identity from the token (client-supplied nickname is
 * ignored then). Empty headers (no reader_token) keeps anonymous comments
 * working unchanged. (DEC-062, TASK-136)
 */
export function createComment(
	postId: number,
	data: {
		nickname: string;
		email: string;
		content: string;
		parent_id?: number | null;
		website?: string;
	},
): Promise<Comment> {
	return command<Comment>(`/api/comments/post/${postId}`, {
		method: "POST",
		body: data,
		headers: readerAuthHeaders(),
	});
}
