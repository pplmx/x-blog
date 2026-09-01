import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBlogStats } from "../../../api/public/stats.ts";

let queryCalls: Array<{ path: unknown; options: Record<string, unknown> }>;

beforeEach(() => {
	queryCalls = [];
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
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("public stats", () => {
	it("preserves the blog stats endpoint", () => {
		useBlogStats();

		expect(queryCalls[0]).toEqual({
			path: "/api/stats",
			options: { baseURL: "https://api.example.test", onResponseError: expect.any(Function) },
		});
	});
});
