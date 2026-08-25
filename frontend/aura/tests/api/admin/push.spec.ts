import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { notifyPushSubscribers } from "../../../api/admin/push";

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
		getItem: (key: string) => (key === "admin_token" ? "admin-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin push broadcast", () => {
	it("notifies all subscribers with a POST body and admin headers", async () => {
		await notifyPushSubscribers({
			title: "新文章发布",
			body: "快来看看",
			url: "/posts/my-post",
		});

		expect(commandCalls[0].path).toBe("/api/push/notify");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({
			title: "新文章发布",
			body: "快来看看",
			url: "/posts/my-post",
		});
		expect(commandCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer admin-jwt",
		});
	});
});
