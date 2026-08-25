import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { getSiteSetting, updateSiteSetting, useSiteSetting } from "../../../api/admin/settings";

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
		getItem: (key: string) => (key === "admin_token" ? "admin-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin settings", () => {
	it("reads a setting reactively with admin headers", () => {
		useSiteSetting("auto_approve_reader_comments");

		expect(queryCalls[0].path).toBe("/api/admin/settings/auto_approve_reader_comments");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});

	it("reads a setting imperatively", async () => {
		await getSiteSetting("auto_approve_reader_comments");

		expect(commandCalls[0].path).toBe("/api/admin/settings/auto_approve_reader_comments");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});

	it("persists a setting with PUT and a value body", async () => {
		await updateSiteSetting("auto_approve_reader_comments", "true");

		expect(commandCalls[0].path).toBe("/api/admin/settings/auto_approve_reader_comments");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.body).toEqual({ value: "true" });
		expect(commandCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer admin-jwt",
		});
	});
});
