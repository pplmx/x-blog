import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	clearReaderHistory,
	getReaderHistory,
	getReaderHistoryStats,
	getReaderReadingPosition,
	recordReaderHistory,
	useReaderRecommendations,
	useReaderSeriesProgress,
} from "../../../api/reader/history.ts";

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
		return Promise.resolve({ items: [], total: 0 });
	}) as Mock);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => (key === "reader_token" ? "reader-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("reader history queries", () => {
	it("fetches recommendations reactively with the reader headers", () => {
		useReaderRecommendations(4);

		expect(queryCalls[0].path).toBe("/api/reader/me/recommendations");
		expect(queryCalls[0].options.query).toEqual({ limit: 4 });
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});

	it("fetches per-series progress reactively", () => {
		useReaderSeriesProgress("tutorial");

		expect(queryCalls[0].path).toBe("/api/reader/me/series/tutorial/progress");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});
});

describe("reader history commands", () => {
	it("fetches the history list imperatively with reader headers and search", async () => {
		await getReaderHistory(2, 10, "  nuxt  ");

		expect(commandCalls[0].path).toBe("/api/reader/me/history");
		expect(commandCalls[0].options).toEqual({
			baseURL: "https://api.example.test",
			query: { page: 2, limit: 10, q: "nuxt" },
			headers: { Authorization: "Bearer reader-jwt" },
		});
	});

	it("omits the search query when blank", async () => {
		await getReaderHistory(1, 50);

		expect(commandCalls[0].options.query).toEqual({ page: 1, limit: 50, q: undefined });
	});

	it("records a view with an optional scroll position in the body", async () => {
		await recordReaderHistory(7);
		await recordReaderHistory(7, 320);

		expect(commandCalls[0].path).toBe("/api/reader/me/history/7");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toBeUndefined();
		expect(commandCalls[1].options.body).toEqual({ scroll_position: 320 });
	});

	it("reads the reader reading position imperatively", async () => {
		await getReaderReadingPosition(7);

		expect(commandCalls[0].path).toBe("/api/reader/me/history/7");
		expect(commandCalls[0].options.method).toBeUndefined();
	});

	it("fetches history stats imperatively", async () => {
		await getReaderHistoryStats();

		expect(commandCalls[0].path).toBe("/api/reader/me/history/stats");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("clears history with DELETE", async () => {
		await clearReaderHistory();

		expect(commandCalls[0].path).toBe("/api/reader/me/history");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});
});
