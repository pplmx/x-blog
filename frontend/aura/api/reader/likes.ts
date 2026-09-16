import { readerAuthHeaders } from "../auth";
import type { PostList, PostListResponse } from "../contracts/shared";
import { command, query } from "../transport";

/** A signed-in reader's liked-posts list (round 359): a paginated, publicly-
 *  visible, newest-like-first PostListResponse — the reader-owned surface
 *  that joins bookmarks (saved-to-read) and history (read) on the "posts I
 *  appreciated" axis. */
export function useReaderLikes() {
	return query<PostListResponse>("/api/reader/me/likes", {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Imperative liked-posts fetch for sync/merge handlers that need the data
 *  directly (bounded paging via the page/limit contract, like bookmarks).
 *  `q` (optional) filters to liked posts matching title/excerpt (DEC-413). */
export function getReaderLikes(
	page?: number,
	limit?: number,
	q?: string,
): Promise<PostListResponse> {
	return command<PostListResponse>("/api/reader/me/likes", {
		query: { page, limit, q: q?.trim() || undefined },
		headers: readerAuthHeaders(),
	});
}

export interface AddLikeResponse {
	post_id: number;
	already_existed: boolean;
}

/** Like a post as a signed-in reader (round 359). Idempotent server-side: the
 *  public counter is bumped exactly once per NEW like. */
export function likeReaderPost(postId: number): Promise<AddLikeResponse> {
	return command<AddLikeResponse>(`/api/reader/me/likes/${postId}`, {
		method: "POST",
		headers: readerAuthHeaders(),
	});
}

/** Remove the reader's like of a post (round 359): idempotent 204, decrements
 *  the public counter only when a like row was actually removed. */
export function unlikeReaderPost(postId: number): Promise<void> {
	return command<void>(`/api/reader/me/likes/${postId}`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

// Re-export the post-list response type so the liked-posts page can type its
// fetched list without importing the transport layer directly.
export type { PostList };
