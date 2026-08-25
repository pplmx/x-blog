import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { getCategories, useCategories, useTags } from "../../../api/public/taxonomy.ts";

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
		return Promise.resolve([{ id: 1, name: "Tech" }]);
	}) as Mock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("public taxonomy", () => {
	it("queries the categories and tags endpoints", () => {
		useCategories();
		useTags();

		expect(queryCalls.map((call) => call.path)).toEqual(["/api/categories", "/api/tags"]);
		expect(queryCalls[0].options.baseURL).toBe("https://api.example.test");
		expect(queryCalls[1].options.baseURL).toBe("https://api.example.test");
	});

	it("gets categories as a plain awaitable command", async () => {
		await expect(getCategories()).resolves.toEqual([{ id: 1, name: "Tech" }]);
		expect(commandCalls[0]).toEqual({
			path: "/api/categories",
			options: { baseURL: "https://api.example.test" },
		});
	});
});
