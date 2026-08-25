import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	createComment,
	flagComment,
	getComments,
	likeComment,
	useComments,
} from "../../../api/public/comments.ts";

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
		return Promise.resolve({ id: 7 });
	}) as Mock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("public comments queries", () => {
	it("fetches the comment thread with page, limit, and sort for setup usage", () => {
		useComments(12, 2, 20, "likes");

		expect(queryCalls).toEqual([
			{
				path: "/api/comments/post/12",
				options: {
					baseURL: "https://api.example.test",
					query: { page: 2, limit: 20, sort: "likes" },
				},
			},
		]);
	});

	it("defaults to the first page, 20 items, and newest sort", () => {
		useComments(12);

		expect(queryCalls[0].options.query).toEqual({ page: 1, limit: 20, sort: "newest" });
	});
});

describe("public comments commands", () => {
	it("fetches a page imperatively as a direct promise", async () => {
		const result = getComments(12, 3, 10, "oldest");

		expect(result).toBeInstanceOf(Promise);
		await result;
		expect(commandCalls[0]).toEqual({
			path: "/api/comments/post/12",
			options: {
				baseURL: "https://api.example.test",
				query: { page: 3, limit: 10, sort: "oldest" },
			},
		});
	});

	it("likes a comment through an imperative POST command", async () => {
		const result = likeComment(7);

		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toEqual({ id: 7 });
		expect(commandCalls[0]).toEqual({
			path: "/api/comments/7/like",
			options: { baseURL: "https://api.example.test", method: "POST" },
		});
	});

	it("flags a comment through an imperative POST command", async () => {
		const result = flagComment(7);

		expect(result).toBeInstanceOf(Promise);
		await result;
		expect(commandCalls[0]).toEqual({
			path: "/api/comments/7/flag",
			options: { baseURL: "https://api.example.test", method: "POST" },
		});
	});

	it("creates a comment with body and the reader audience headers", async () => {
		const body = { nickname: "Ana", email: "ana@example.test", content: "Hi", parent_id: null };
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => (key === "reader_token" ? "reader-jwt" : null),
		});

		await createComment(12, body);

		expect(commandCalls[0]).toEqual({
			path: "/api/comments/post/12",
			options: {
				baseURL: "https://api.example.test",
				method: "POST",
				body,
				headers: { Authorization: "Bearer reader-jwt" },
			},
		});
	});
});
