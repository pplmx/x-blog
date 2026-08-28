import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	likePost,
	recordPostView,
	useAdjacentPosts,
	usePopularPosts,
	usePost,
	usePostArchive,
	usePostSearch,
	usePosts,
	useRelatedPosts,
} from "../../../api/public/posts.ts";

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

describe("public posts queries", () => {
	it("builds the posts URL from a reactive filter getter", () => {
		let page = 2;
		usePosts(() => ({ category_id: 3, page, limit: 10 }));

		const path = queryCalls[0].path as () => string;
		expect(path()).toBe("/api/posts?category_id=3&page=2&limit=10");
		page = 4;
		expect(path()).toBe("/api/posts?category_id=3&page=4&limit=10");
	});

	it("builds the search URL from a reactive parameter getter", () => {
		let q = "vue & nuxt";
		usePostSearch(() => ({ q, page: 1, limit: 5, sort: "views" }));

		const path = queryCalls[0].path as () => string;
		expect(path()).toBe("/api/search?q=vue+%26+nuxt&page=1&limit=5&sort=views");
		q = "fast api";
		expect(path()).toBe("/api/search?q=fast+api&page=1&limit=5&sort=views");
	});

	it("preserves post, archive, popular, related, and adjacent endpoints", () => {
		usePost("hello-world", { server: true });
		usePostArchive();
		usePopularPosts(8);
		useRelatedPosts(7, 4);
		useAdjacentPosts(7);

		expect(queryCalls.map((call) => call.path)).toEqual([
			"/api/posts/hello-world",
			"/api/posts/archive",
			"/api/posts/popular/list",
			"/api/posts/7/related",
			"/api/posts/7/adjacent",
		]);
		expect(queryCalls[0].options.server).toBe(true);
		expect(queryCalls[2].options.query).toEqual({ limit: 8 });
		expect(queryCalls[3].options.query).toEqual({ limit: 4 });
	});

	it("keeps reactive post-dependent paths nullable until an id exists", () => {
		let id: number | undefined;
		useRelatedPosts(() => id);
		useAdjacentPosts(() => id);

		const relatedPath = queryCalls[0].path as () => string | null;
		const adjacentPath = queryCalls[1].path as () => string | null;
		expect(relatedPath()).toBeNull();
		expect(adjacentPath()).toBeNull();
		id = 9;
		expect(relatedPath()).toBe("/api/posts/9/related");
		expect(adjacentPath()).toBe("/api/posts/9/adjacent");
	});
});

describe("public posts commands", () => {
	it("records a post view through an imperative POST command", async () => {
		const result = recordPostView(7);

		expect(result).toBeInstanceOf(Promise);
		await expect(result).resolves.toEqual({ id: 7 });
		expect(commandCalls[0]).toEqual({
			path: "/api/posts/7/view",
			// fire-and-forget: keepalive survives a quick back/forward so the
			// count isn't lost mid-navigation (ISS-121 e2e flake)
			options: { baseURL: "https://api.example.test", method: "POST", keepalive: true },
		});
	});

	it("likes a post through an imperative POST command", async () => {
		const result = likePost(7);

		expect(result).toBeInstanceOf(Promise);
		await result;
		expect(commandCalls[0]).toEqual({
			path: "/api/posts/7/like",
			options: { baseURL: "https://api.example.test", method: "POST" },
		});
	});
});
