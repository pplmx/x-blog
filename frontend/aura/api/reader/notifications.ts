import { readerAuthHeaders } from "../auth";
import { command } from "../transport";

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
export function getReaderNotifications(
	page = 1,
	limit = 50,
	unreadOnly = false,
): Promise<ReaderNotificationListResponse> {
	return command<ReaderNotificationListResponse>("/api/reader/me/notifications", {
		query: { page, limit, unread: unreadOnly ? "true" : undefined },
		headers: readerAuthHeaders(),
	});
}

/** Mark one notification read (404 if it isn't the reader's). */
export function markReaderNotificationRead(notificationId: number): Promise<ReaderNotification> {
	return command<ReaderNotification>(`/api/reader/me/notifications/${notificationId}/read`, {
		method: "POST",
		headers: readerAuthHeaders(),
	});
}

/** Mark every unread notification read; returns the count updated. */
export function markAllReaderNotificationsRead(): Promise<{ updated: number }> {
	return command<{ updated: number }>("/api/reader/me/notifications/read-all", {
		method: "POST",
		headers: readerAuthHeaders(),
	});
}

/** A reader's per-kind notification opt-outs. Every true = all kinds on. */
export interface ReaderNotificationPrefs {
	new_post: boolean;
	reply: boolean;
	thread_comment: boolean;
	/** Email channel (DEC-197, TASK-217): per-kind opt-in SMTP copy of the fan-out. */
	email_new_post: boolean;
	email_reply: boolean;
	email_thread_comment: boolean;
}

/** The signed-in reader's per-kind notification preferences (all-on default). */
export function getReaderNotificationPrefs(): Promise<ReaderNotificationPrefs> {
	return command<ReaderNotificationPrefs>("/api/reader/me/notification-preferences", {
		headers: readerAuthHeaders(),
	});
}

/** Toggle one notification kind; returns the reader's full updated prefs. */
export function updateReaderNotificationPref(
	kind: keyof ReaderNotificationPrefs,
	enabled: boolean,
): Promise<ReaderNotificationPrefs> {
	return command<ReaderNotificationPrefs>("/api/reader/me/notification-preferences", {
		method: "PATCH",
		headers: readerAuthHeaders(),
		body: { kind, enabled },
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
export function getMyPushSubscriptions(): Promise<ReaderPushSubscriptionListResponse> {
	return command<ReaderPushSubscriptionListResponse>("/api/reader/me/push-subscriptions", {
		headers: readerAuthHeaders(),
	});
}

/** Revoke one of the reader's push subscriptions (204; 404 for another's). */
export function revokeMyPushSubscription(subscriptionId: number): Promise<void> {
	return command<void>(`/api/reader/me/push-subscriptions/${subscriptionId}`, {
		method: "DELETE",
		headers: readerAuthHeaders(),
	});
}

/**
 * Update the new-post notification prefs on one of the reader's devices
 * (DEC-076/TASK-147). `new_post_category_id` null = all new posts.
 */
export function updateMyPushSubscriptionPrefs(
	subscriptionId: number,
	prefs: { want_new_posts: boolean; new_post_category_id: number | null },
): Promise<ReaderPushSubscription> {
	return command<ReaderPushSubscription>(`/api/reader/me/push-subscriptions/${subscriptionId}`, {
		method: "PATCH",
		headers: readerAuthHeaders(),
		body: prefs,
	});
}
