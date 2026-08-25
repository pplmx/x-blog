import { readerAuthHeaders } from "../auth";
import type { Comment } from "../contracts/shared";
import { command } from "../transport";

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
 * token). Imperative command (client-only read invoked from onMounted / after
 * delete) — never a setup `useFetch`, whose non-setup execution can resolve
 * before the data ref arrives. (DEC-066, TASK-139/140)
 */
export function getMyComments(
	status: MyCommentStatusFilter = "all",
	page = 1,
	limit = 20,
): Promise<MyCommentListResponse> {
	return command<MyCommentListResponse>("/api/reader/me/comments", {
		query: { status, page, limit },
		headers: readerAuthHeaders(),
	});
}

/** Delete one of the reader's own comments (204; 404 for another's / unknown). */
export function deleteMyComment(commentId: number): Promise<void> {
	return command<void>(`/api/reader/me/comments/${commentId}`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** Update one of the reader's own comments (returns the updated CommentPublic;
 *  404 for another's / unknown). (DEC-096, TASK-160) */
export function updateMyComment(commentId: number, content: string): Promise<Comment> {
	return command<Comment>(`/api/reader/me/comments/${commentId}`, {
		method: "PATCH",
		headers: readerAuthHeaders(),
		body: { content },
	});
}
