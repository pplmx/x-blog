import { type MaybeRefOrGetter, toValue } from "vue";
import { readerAuthHeaders } from "../auth";
import type { Comment, PaginationInfo } from "../contracts/shared";
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
 * Flip a guest comment's reply-email consent off via its emailed token
 * (POST /api/comments/reply-notify/unsubscribe, DEC-332/TASK-392). The
 * per-comment token comes from the unsubscribe link in the guest reply email;
 * posting it proves the address holder owns the comment. 404 = unknown token.
 */
export function unsubscribeGuestReplyNotify(token: string): Promise<{
	unsubscribed: boolean;
}> {
	return command<{ unsubscribed: boolean }>("/api/comments/reply-notify/unsubscribe", {
		method: "POST",
		body: { token },
	});
}

/**
 * Subscribe an ANONYMOUS visitor to a post's comment thread by email
 * (POST /api/posts/{postId}/comment-subscription/guest, DEC-427/TASK-438).
 * Auth-free, 202, generic no-oracle response; a double opt-in email is sent
 * and nothing else until the confirmation link is clicked. Guests only — a
 * signed-in reader has the push thread-follow instead. `digestWeekly` (round
 * 381, DEC-429) records a weekly-summary cadence at subscribe time; default
 * stays per-comment.
 */
export function subscribeGuestThread(
	postId: number,
	email: string,
	digestWeekly = false,
): Promise<{ subscribed: boolean }> {
	return command<{ subscribed: boolean }>(`/api/posts/${postId}/comment-subscription/guest`, {
		method: "POST",
		body: { email, digest_weekly: digestWeekly },
	});
}

/** Confirm a guest thread-follow via its emailed token (idempotent 200;
 *  404 = unknown token). POST /api/posts/comment-subscription/guest/confirm.
 *  The stored cadence rides back so the confirm page can seed its toggle. */
export function confirmGuestThreadSubscription(
	token: string,
): Promise<{ confirmed: boolean; digest_weekly: boolean }> {
	return command<{ confirmed: boolean; digest_weekly: boolean }>(
		"/api/posts/comment-subscription/guest/confirm",
		{
			method: "POST",
			body: { token },
		},
	);
}

/** Flip a guest thread-follow's cadence via its emailed token (round 381,
 *  DEC-429): weekly summary vs a mail per approved comment. Idempotent 200;
 *  404 = unknown token. POST /api/posts/comment-subscription/guest/digest. */
export function setGuestThreadDigest(
	token: string,
	digestWeekly: boolean,
): Promise<{ digest_weekly: boolean; updated: boolean }> {
	return command<{ digest_weekly: boolean; updated: boolean }>(
		"/api/posts/comment-subscription/guest/digest",
		{
			method: "POST",
			body: { token, digest_weekly: digestWeekly },
		},
	);
}

/** Flip a guest thread-follow's consent off via its emailed token (idempotent
 *  200; 404 = unknown token). POST /api/posts/comment-subscription/guest/unsubscribe. */
export function unsubscribeGuestThreadSubscription(
	token: string,
): Promise<{ unsubscribed: boolean }> {
	return command<{ unsubscribed: boolean }>("/api/posts/comment-subscription/guest/unsubscribe", {
		method: "POST",
		body: { token },
	});
}

/** One entry on the site-wide discussion feed (round 367, DEC-407). */
export interface DiscussionFeedItem {
	id: number;
	nickname: string;
	content: string;
	likes: number;
	created_at: string;
	reader: Comment["reader"];
	/** The post the comment lives on (for the deep link onto the comment). */
	post: { id: number; title: string; slug: string } | null;
}

export interface DiscussionFeedResponse {
	items: DiscussionFeedItem[];
	pagination: PaginationInfo;
}

/**
 * Site-wide discussion feed (GET /api/comments/feed, round 367 / DEC-407).
 *
 * The newest approved comments on publicly-visible posts, each with the
 * commenter identity and the post brief so a card can deep-link onto the exact
 * comment. Search (DEC-405) made the discussion FINDABLE; the feed makes it
 * BROWSABLE. Public, no auth, paginated.
 */
export function useDiscussionFeed(page: MaybeRefOrGetter<number> = 1, limit = 20) {
	return query<DiscussionFeedResponse>(
		() => `/api/comments/feed?page=${toValue(page)}&limit=${limit}`,
	);
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
		/** Guest reply-email consent (DEC-332): a guest ticks "email me when
		 * someone replies" and the backend emails their stored address when a
		 * reply to this comment is approved. Ignored for signed-in readers. */
		reply_notify_email?: boolean;
	},
): Promise<Comment> {
	return command<Comment>(`/api/comments/post/${postId}`, {
		method: "POST",
		body: data,
		headers: readerAuthHeaders(),
	});
}
