import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	getMyPushSubscriptions,
	getReaderNotificationPrefs,
	getReaderNotifications,
	markAllReaderNotificationsRead,
	markReaderNotificationRead,
	revokeMyPushSubscription,
	updateMyPushSubscriptionPrefs,
	updateReaderNotificationPref,
} from "../../../api/reader/notifications.ts";

let commandCalls: Array<{ path: string; options: Record<string, unknown> }>;

beforeEach(() => {
	commandCalls = [];
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
	vi.stubGlobal("$fetch", ((path: string, options: Record<string, unknown> = {}) => {
		commandCalls.push({ path, options });
		return Promise.resolve({});
	}) as Mock);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => (key === "reader_token" ? "reader-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("reader notification commands", () => {
	it("lists the inbox with page/limit and an optional unread filter", async () => {
		await getReaderNotifications(2, 30, true);

		expect(commandCalls[0].path).toBe("/api/reader/me/notifications");
		expect(commandCalls[0].options.query).toEqual({ page: 2, limit: 30, unread: "true" });
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("omits the unread filter when listing everything", async () => {
		await getReaderNotifications(1, 50);

		expect(commandCalls[0].options.query).toEqual({ page: 1, limit: 50, unread: undefined });
	});

	it("marks one notification read with POST", async () => {
		await markReaderNotificationRead(9);

		expect(commandCalls[0].path).toBe("/api/reader/me/notifications/9/read");
		expect(commandCalls[0].options.method).toBe("POST");
	});

	it("marks all notifications read with POST", async () => {
		await markAllReaderNotificationsRead();

		expect(commandCalls[0].path).toBe("/api/reader/me/notifications/read-all");
		expect(commandCalls[0].options.method).toBe("POST");
	});

	it("reads notification preferences", async () => {
		await getReaderNotificationPrefs();

		expect(commandCalls[0].path).toBe("/api/reader/me/notification-preferences");
	});

	it("toggles a notification kind with a PATCH body", async () => {
		await updateReaderNotificationPref("reply", false);

		expect(commandCalls[0].path).toBe("/api/reader/me/notification-preferences");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ kind: "reply", enabled: false });
	});

	it("lists the reader push subscriptions", async () => {
		await getMyPushSubscriptions();

		expect(commandCalls[0].path).toBe("/api/reader/me/push-subscriptions");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("revokes a push subscription with DELETE", async () => {
		await revokeMyPushSubscription(5);

		expect(commandCalls[0].path).toBe("/api/reader/me/push-subscriptions/5");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});

	it("updates push prefs with a PATCH body", async () => {
		await updateMyPushSubscriptionPrefs(5, { want_new_posts: true, new_post_category_id: 3 });

		expect(commandCalls[0].path).toBe("/api/reader/me/push-subscriptions/5");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ want_new_posts: true, new_post_category_id: 3 });
	});
});
