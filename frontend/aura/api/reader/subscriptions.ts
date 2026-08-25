import { readerAuthHeaders } from "../auth";
import { command, query } from "../transport";

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

/** Reactive follow status for one post (anonymous readers get subscribed: false). */
export function usePostSubscription(postId: number) {
	return query<PostSubscriptionStatus>(`/api/posts/${postId}/subscription`, {
		headers: readerAuthHeaders(),
		server: false,
	});
}

/** Follow a post's comment thread (idempotent; reader token required). */
export function subscribeToPostThread(postId: number): Promise<PostSubscriptionStatus> {
	return command<PostSubscriptionStatus>(`/api/posts/${postId}/subscription`, {
		method: "PUT",
		headers: readerAuthHeaders(),
	});
}

/** Unfollow a post's comment thread (idempotent 204). */
export function unsubscribeFromPostThread(postId: number): Promise<null> {
	return command<null>(`/api/posts/${postId}/subscription`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/** The followed comment threads for the account page (imperative read). */
export function getMyPostSubscriptions(): Promise<SubscribedThreadListResponse> {
	return command<SubscribedThreadListResponse>("/api/reader/me/post-subscriptions", {
		headers: readerAuthHeaders(),
	});
}
