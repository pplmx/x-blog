import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { command, query, withQuery } from "../../api/transport.ts";

let useFetchCalls: Array<{
	path: unknown;
	options: Record<string, unknown>;
}>;
let commandCalls: Array<{
	path: string;
	options: Record<string, unknown>;
}>;

beforeEach(() => {
	useFetchCalls = [];
	commandCalls = [];

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
	vi.stubGlobal(
		"useFetch",
		vi.fn((path: unknown, options: Record<string, unknown> = {}) => {
			useFetchCalls.push({ path, options });
			return { data: null, error: null };
		}),
	);
	vi.stubGlobal("$fetch", ((path: string, options: Record<string, unknown> = {}) => {
		commandCalls.push({ path, options });
		return Promise.resolve({ ok: true });
	}) as Mock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("query", () => {
	it("resolves the API base URL and forwards query options", () => {
		const options = { query: { page: 2 }, server: false };

		query("/api/posts", options);

		expect(useFetchCalls).toEqual([
			{
				path: "/api/posts",
				options: {
					baseURL: "https://api.example.test",
					query: { page: 2 },
					server: false,
				},
			},
		]);
	});

	it("forwards a reactive path getter unchanged", () => {
		const path = () => "/api/posts/current";

		query(path);

		expect(useFetchCalls[0].path).toBe(path);
	});

	it("returns the exact object produced by useFetch", () => {
		const result = query("/api/posts");

		expect(result).toBe((useFetch as Mock).mock.results[0]?.value);
	});
});

describe("command", () => {
	it("uses imperative $fetch with the configured API base URL", async () => {
		const result = await command<{ ok: boolean }>("/api/posts/7");

		expect(result).toEqual({ ok: true });
		expect(commandCalls).toEqual([
			{
				path: "/api/posts/7",
				options: { baseURL: "https://api.example.test" },
			},
		]);
	});

	it("forwards method, headers, and body", async () => {
		const body = { title: "New post" };
		const headers = { Authorization: "Bearer token", "Content-Type": "application/json" };

		await command("/api/posts", { method: "POST", headers, body });

		expect(commandCalls[0].options).toEqual({
			baseURL: "https://api.example.test",
			method: "POST",
			headers,
			body,
		});
	});
});

describe("withQuery", () => {
	it("omits nullish and empty values while preserving zero and false", () => {
		expect(withQuery("/api/x", { zero: 0, off: false, empty: "", none: null })).toBe(
			"/api/x?zero=0&off=false",
		);
	});

	it("encodes query keys and values with URLSearchParams", () => {
		expect(withQuery("/api/search", { "topic name": "Nuxt & Vue", page: 1 })).toBe(
			"/api/search?topic+name=Nuxt+%26+Vue&page=1",
		);
	});

	it("does not append a question mark when every value is omitted", () => {
		expect(withQuery("/api/x", { empty: "", missing: undefined, none: null })).toBe("/api/x");
	});
});
