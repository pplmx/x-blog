import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	getMyPostSubscriptions,
	subscribeToPostThread,
	unsubscribeFromPostThread,
	usePostSubscription,
} from "../../../api/reader/subscriptions.ts";

let queryCalls: Array<{ path: unknown; options: Record<string, unknown> }>;
let commandCalls: Array<{ path: string; options: Record<string, unknown> }>;

beforeEach(() => {
	queryCalls = [];
	commandCalls = [];
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
	vi.stubGlobal(
		"useFetch",
		vi.fn((path: unknown, options: Record<string, unknown> = {}) => {
			queryCalls.push({ path, options });
			return { data: null, error: null };
		}),
	);
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

describe("reader subscription queries", () => {
	it("fetches a post subscription reactively", () => {
		usePostSubscription(7);

		expect(queryCalls[0].path).toBe("/api/posts/7/subscription");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});
});

describe("reader subscription commands", () => {
	it("subscribes to a post thread with PUT", async () => {
		await subscribeToPostThread(7);

		expect(commandCalls[0].path).toBe("/api/posts/7/subscription");
		expect(commandCalls[0].options.method).toBe("PUT");
	});

	it("unsubscribes from a post thread with DELETE", async () => {
		await unsubscribeFromPostThread(7);

		expect(commandCalls[0].path).toBe("/api/posts/7/subscription");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});

	it("lists the followed threads imperatively", async () => {
		await getMyPostSubscriptions();

		expect(commandCalls[0].path).toBe("/api/reader/me/post-subscriptions");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});
});
