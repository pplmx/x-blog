/**
 * API composable tests
 * Tests useApi, usePosts, useCategories, useTags composables.
 * Mocks Nuxt's useFetch and useRuntimeConfig to verify URL construction,
 * base URL configuration, and query parameter building.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	adminLogin,
	approveAdminComment,
	batchApproveAdminComment,
	createAdminCategory,
	createAdminPost,
	createAdminSeries,
	createAdminTag,
	createAdminUser,
	createComment,
	deleteAdminCategory,
	deleteAdminComment,
	deleteAdminPost,
	deleteAdminSeries,
	deleteAdminTag,
	deleteAdminUser,
	fetchAdminCategories,
	fetchAdminComments,
	fetchAdminPosts,
	fetchAdminSeries,
	fetchAdminTags,
	fetchAdminUsers,
	fetchComments,
	fetchCurrentAdmin,
	fetchReaderReadingPosition,
	notifyPushSubscribers,
	recordReaderHistory,
	updateAdminCategory,
	updateAdminPost,
	updateAdminSeries,
	updateAdminTag,
	useApi,
	useBlogStats,
	useCategories,
	usePopularPosts,
	usePost,
	usePostLike,
	usePosts,
	usePostView,
	useRelatedPosts,
	useSearch,
	useSeries,
	useSeriesBySlug,
	useTags,
} from "../../composables/useApi.ts";

// Capture what useFetch is called with
let useFetchCalls: Array<{
	url: string;
	options: Record<string, unknown>;
}>;
// Some admin readers use $fetch (the imperative fetch helpers) — capture it too.
let $fetchCalls: Array<{
	url: string;
	options: Record<string, unknown>;
}>;

beforeEach(() => {
	useFetchCalls = [];
	$fetchCalls = [];

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: {
			apiUrl: "http://localhost:18888",
		},
	}));

	vi.stubGlobal("useFetch", ((url: string, options: Record<string, unknown> = {}) => {
		useFetchCalls.push({ url, options });
		// Return a mock ref-like object with the resolved URL for test assertions
		return {
			url,
			options,
			pending: false,
			error: null,
			data: null,
			refresh: vi.fn(),
		};
	}) as Mock);

	vi.stubGlobal("$fetch", ((url: string, options: Record<string, unknown> = {}) => {
		$fetchCalls.push({ url, options });
		return Promise.resolve({});
	}) as Mock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────
// Admin API tests
// ─────────────────────────────────────────────────────────────

describe("admin API functions", () => {
	beforeEach(() => {
		// Mock localStorage for auth token
		Object.defineProperty(window, "localStorage", {
			value: {
				getItem: vi.fn(() => "test-token"),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
			writable: true,
		});
	});

	it("fetchAdminPosts constructs the correct URL with auth header", () => {
		fetchAdminPosts();
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/posts");
		expect(useFetchCalls[0].options.headers).toEqual({ Authorization: "Bearer test-token" });
	});

	it("fetchAdminPost constructs URL with post ID", () => {
		fetchAdminPost(42);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/posts/42");
	});

	it("createAdminPost sends POST with body", () => {
		createAdminPost({
			title: "New Post",
			slug: "new-post",
			content: "# Hello",
			excerpt: "Hello world",
			published: true,
		});
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/posts");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
		});
	});

	it("updateAdminPost sends PUT with ID and body", () => {
		updateAdminPost(10, { title: "Updated" });
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/posts/10");
		expect(useFetchCalls[0].options.method).toBe("PUT");
		expect(useFetchCalls[0].options.body).toEqual({ title: "Updated" });
	});

	it("deleteAdminPost sends DELETE with ID", () => {
		deleteAdminPost(5);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/posts/5");
		expect(useFetchCalls[0].options.method).toBe("DELETE");
	});

	it("fetchAdminCategories constructs correct URL", () => {
		fetchAdminCategories();
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/categories");
	});

	it("createAdminCategory sends POST with name", () => {
		createAdminCategory("New Category");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.body).toEqual({ name: "New Category" });
	});

	it("updateAdminCategory sends PUT with ID and name", () => {
		updateAdminCategory(3, "Updated Category");
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/categories/3");
		expect(useFetchCalls[0].options.method).toBe("PUT");
		expect(useFetchCalls[0].options.body).toEqual({ name: "Updated Category" });
	});

	it("deleteAdminCategory sends DELETE with ID", () => {
		deleteAdminCategory(7);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/categories/7");
		expect(useFetchCalls[0].options.method).toBe("DELETE");
	});

	it("fetchAdminTags constructs correct URL", () => {
		fetchAdminTags();
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/tags");
	});

	it("createAdminTag sends POST with name", () => {
		createAdminTag("New Tag");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.body).toEqual({ name: "New Tag" });
	});

	it("updateAdminTag sends PUT with ID and name", () => {
		updateAdminTag(2, "Updated Tag");
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/tags/2");
		expect(useFetchCalls[0].options.method).toBe("PUT");
	});

	it("deleteAdminTag sends DELETE with ID", () => {
		deleteAdminTag(8);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/tags/8");
		expect(useFetchCalls[0].options.method).toBe("DELETE");
	});

	it("fetchAdminComments constructs correct URL", async () => {
		await fetchAdminComments();
		expect($fetchCalls[0].url).toBe("http://localhost:18888/api/admin/comments?page=1&limit=20");
	});

	it("fetchAdminComments with postId adds query parameter", async () => {
		await fetchAdminComments({ postId: 15 });
		expect($fetchCalls[0].url).toBe(
			"http://localhost:18888/api/admin/comments?post_id=15&page=1&limit=20",
		);
	});

	it("fetchAdminComments passes page and limit through", async () => {
		await fetchAdminComments({}, 3, 100);
		expect($fetchCalls[0].url).toBe("http://localhost:18888/api/admin/comments?page=3&limit=100");
	});

	it("fetchAdminComments passes moderation filters through", async () => {
		await fetchAdminComments({
			isApproved: false,
			q: "carol",
			dateFrom: "2026-01-01",
			dateTo: "2026-12-31",
		});
		expect($fetchCalls[0].url).toBe(
			"http://localhost:18888/api/admin/comments?is_approved=false&q=carol&date_from=2026-01-01&date_to=2026-12-31&page=1&limit=20",
		);
	});

	it("deleteAdminComment sends DELETE with ID", () => {
		deleteAdminComment(20);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/comments/20");
		expect(useFetchCalls[0].options.method).toBe("DELETE");
	});

	it("approveAdminComment sends PATCH with approved status", () => {
		approveAdminComment(25, true);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/comments/25/approve");
		expect(useFetchCalls[0].options.method).toBe("PATCH");
		expect(useFetchCalls[0].options.body).toEqual({ approved: true });
	});

	it("batchApproveAdminComment sends POST with ids and approved status", () => {
		batchApproveAdminComment([1, 2, 3], true);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/comments/batch-approve");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
		});
		expect(useFetchCalls[0].options.body).toEqual({
			ids: [1, 2, 3],
			approved: true,
		});
	});
});

describe("useApi", () => {
	it("passes the baseURL from runtime config", () => {
		useApi("/api/posts");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("passes custom options through to useFetch", () => {
		useApi("/api/posts", { query: { page: 2 } });
		expect(useFetchCalls[0].options.query).toEqual({ page: 2 });
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("passes the url through unchanged", () => {
		useApi("/api/categories");
		expect(useFetchCalls[0].url).toBe("/api/categories");
	});
});

describe("usePosts", () => {
	it("fetches the posts endpoint with no filters", () => {
		usePosts();
		expect(useFetchCalls[0].url).toBe("/api/posts");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("fetches the posts endpoint with empty filters object", () => {
		usePosts({});
		expect(useFetchCalls[0].url).toBe("/api/posts");
	});

	it("appends category_id to the query string", () => {
		usePosts({ category_id: 5 });
		expect(useFetchCalls[0].url).toBe("/api/posts?category_id=5");
	});

	it("appends tag_id to the query string", () => {
		usePosts({ tag_id: 3 });
		expect(useFetchCalls[0].url).toContain("tag_id=3");
	});

	it("appends page and limit to the query string", () => {
		usePosts({ page: 2, limit: 10 });
		expect(useFetchCalls[0].url).toContain("page=2");
		expect(useFetchCalls[0].url).toContain("limit=10");
	});

	it("combines multiple filters in the query string", () => {
		usePosts({ category_id: 1, tag_id: 2, page: 3, limit: 5 });
		const url = useFetchCalls[0].url;
		expect(url).toContain("category_id=1");
		expect(url).toContain("tag_id=2");
		expect(url).toContain("page=3");
		expect(url).toContain("limit=5");
	});

	it("uses the correct baseURL from config", () => {
		usePosts({ page: 1 });
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});
});

describe("useCategories", () => {
	it("fetches the categories endpoint", () => {
		useCategories();
		expect(useFetchCalls[0].url).toBe("/api/categories");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});
});

describe("useTags", () => {
	it("fetches the tags endpoint", () => {
		useTags();
		expect(useFetchCalls[0].url).toBe("/api/tags");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});
});

describe("usePost", () => {
	it("fetches a post by slug", () => {
		usePost("my-first-post");
		expect(useFetchCalls[0].url).toBe("/api/posts/my-first-post");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("fetches a post by numeric ID", () => {
		usePost(42);
		expect(useFetchCalls[0].url).toBe("/api/posts/42");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("passes custom options through to useFetch", () => {
		usePost("test-slug", { server: true });
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
		expect(useFetchCalls[0].options.server).toBe(true);
	});

	it("uses the correct baseURL from config for slug", () => {
		usePost("hello-world");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});
});

describe("useSearch", () => {
	it("fetches the search endpoint with a query", () => {
		useSearch("test query");
		expect(useFetchCalls[0].url).toContain("/api/search");
		expect(useFetchCalls[0].url).toContain("q=test+query");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("includes page and limit in the query string", () => {
		useSearch("hello", 2, 5);
		const url = useFetchCalls[0].url;
		expect(url).toContain("q=hello");
		expect(url).toContain("page=2");
		expect(url).toContain("limit=5");
	});

	it("uses default page and limit when not specified", () => {
		useSearch("test");
		const url = useFetchCalls[0].url;
		expect(url).toContain("page=1");
		expect(url).toContain("limit=10");
	});

	it("handles multi-word queries with special characters", () => {
		useSearch("hello world & test");
		expect(useFetchCalls[0].url).toContain("q=hello+world+%26+test");
	});
});

describe("usePostView", () => {
	it("posts to the view increment endpoint via $fetch", () => {
		void usePostView(42);
		expect($fetchCalls[0].url).toBe("http://localhost:18888/api/posts/42/view");
		expect($fetchCalls[0].options.method).toBe("POST");
	});

	it("builds the URL from the configured apiUrl", () => {
		void usePostView(1);
		expect($fetchCalls[0].url).toBe("http://localhost:18888/api/posts/1/view");
	});
});

describe("usePostLike", () => {
	it("posts to the like increment endpoint via $fetch", () => {
		void usePostLike(42);
		expect($fetchCalls[0].url).toBe("http://localhost:18888/api/posts/42/like");
		expect($fetchCalls[0].options.method).toBe("POST");
	});
});

describe("usePopularPosts", () => {
	it("fetches popular posts with default limit", () => {
		usePopularPosts();
		expect(useFetchCalls[0].url).toBe("/api/posts/popular/list");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("passes the limit as a query parameter", () => {
		usePopularPosts(10);
		expect(useFetchCalls[0].options.query).toEqual({ limit: 10 });
	});
});

describe("useRelatedPosts", () => {
	it("fetches related posts for a given post ID", () => {
		useRelatedPosts(42);
		expect(useFetchCalls[0].url).toBe("/api/posts/42/related");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("passes the limit as a query parameter", () => {
		useRelatedPosts(1, 5);
		expect(useFetchCalls[0].options.query).toEqual({ limit: 5 });
	});

	it("uses default limit when not specified", () => {
		useRelatedPosts(7);
		const url = useFetchCalls[0].url;
		expect(url).toContain("/api/posts/7/related");
	});
});

describe("fetchComments", () => {
	it("fetches comments for a post with default pagination", () => {
		fetchComments(42);
		expect(useFetchCalls[0].url).toBe("/api/comments/post/42");
		expect(useFetchCalls[0].options.query).toEqual({ page: 1, limit: 20, sort: "newest" });
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("accepts custom page and limit parameters", () => {
		fetchComments(10, 3, 5);
		expect(useFetchCalls[0].options.query).toEqual({ page: 3, limit: 5, sort: "newest" });
	});

	it("passes the requested sort through to the query (DEC-094, TASK-159)", () => {
		fetchComments(10, 1, 20, "likes");
		expect(useFetchCalls[0].options.query).toEqual({ page: 1, limit: 20, sort: "likes" });
	});

	it("returns the comments endpoint URL format", () => {
		fetchComments(99);
		expect(useFetchCalls[0].url).toContain("/api/comments/post/99");
	});
});

describe("createComment", () => {
	it("posts to the comment creation endpoint", () => {
		createComment(42, {
			nickname: "Alice",
			email: "alice@test.com",
			content: "Great post!",
		});
		expect(useFetchCalls[0].url).toBe("/api/comments/post/42");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("sends the comment data as the request body", () => {
		const data = {
			nickname: "Bob",
			email: "bob@test.com",
			content: "Nice article",
		};
		createComment(10, data);
		expect(useFetchCalls[0].options.body).toEqual(data);
	});

	it("handles parent_id for nested comments", () => {
		createComment(1, {
			nickname: "Carol",
			email: "carol@test.com",
			content: "Reply to Bob",
			parent_id: 5,
		});
		expect(useFetchCalls[0].options.body).toEqual({
			nickname: "Carol",
			email: "carol@test.com",
			content: "Reply to Bob",
			parent_id: 5,
		});
	});

	it("accepts null parent_id for top-level comments", () => {
		createComment(1, {
			nickname: "Dave",
			email: "dave@test.com",
			content: "Top level comment",
			parent_id: null,
		});
		expect((useFetchCalls[0].options.body as { parent_id: number | null }).parent_id).toBeNull();
	});
});

describe("series API", () => {
	it("useSeries fetches the public series endpoint", () => {
		useSeries();
		expect(useFetchCalls[0].url).toBe("/api/series");
	});

	it("useSeriesBySlug fetches a series by slug", () => {
		useSeriesBySlug("fastapi-deep-dive");
		expect(useFetchCalls[0].url).toBe("/api/series/fastapi-deep-dive");
	});

	it("useSeriesBySlug accepts a reactive getter returning the slug", () => {
		useSeriesBySlug(() => "nuxt-3-essentials" as string | null);
		// The getter is handed to useFetch (which resolves it reactively); the
		// mock stores it as-is, so resolve it to assert the built URL.
		const urlFn = useFetchCalls[0].url as () => string;
		expect(urlFn()).toBe("/api/series/nuxt-3-essentials");
	});

	it("useSeriesBySlug getter returning null makes useFetch skip the request", () => {
		useSeriesBySlug(() => null);
		// URL resolves to null — useFetch would skip the request. The mock still
		// records one call (it can't skip), so assert the resolved URL is null.
		const urlFn = useFetchCalls[0].url as () => string | null;
		expect(urlFn()).toBeNull();
	});
});

describe("series admin API functions", () => {
	beforeEach(() => {
		Object.defineProperty(window, "localStorage", {
			value: {
				getItem: vi.fn(() => "test-token"),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
			writable: true,
		});
	});

	it("fetchAdminSeries fetches the series list with auth header", () => {
		fetchAdminSeries();
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/series");
		expect(useFetchCalls[0].options.headers).toEqual({ Authorization: "Bearer test-token" });
	});

	it("createAdminSeries sends POST with body and auth", () => {
		createAdminSeries({
			title: "FastAPI Deep Dive",
			slug: "fastapi-deep-dive",
			description: "A tour",
		});
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/series");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
		});
		expect(useFetchCalls[0].options.body).toEqual({
			title: "FastAPI Deep Dive",
			slug: "fastapi-deep-dive",
			description: "A tour",
		});
	});

	it("updateAdminSeries sends PUT with ID and body", () => {
		updateAdminSeries(5, { title: "Renamed" });
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/series/5");
		expect(useFetchCalls[0].options.method).toBe("PUT");
		expect(useFetchCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
		});
		expect(useFetchCalls[0].options.body).toEqual({ title: "Renamed" });
	});

	it("deleteAdminSeries sends DELETE with ID and auth", () => {
		deleteAdminSeries(5);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/series/5");
		expect(useFetchCalls[0].options.method).toBe("DELETE");
		expect(useFetchCalls[0].options.headers).toEqual({ Authorization: "Bearer test-token" });
	});
});

describe("useBlogStats", () => {
	it("fetches the blog stats endpoint", () => {
		useBlogStats();
		expect(useFetchCalls[0].url).toBe("/api/stats");
	});
});

describe("admin user API functions", () => {
	beforeEach(() => {
		Object.defineProperty(window, "localStorage", {
			value: {
				getItem: vi.fn(() => "test-token"),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
			writable: true,
		});
	});

	it("fetchCurrentAdmin fetches the profile with auth", () => {
		fetchCurrentAdmin();
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/me");
		expect(useFetchCalls[0].options.headers).toEqual({ Authorization: "Bearer test-token" });
	});

	it("fetchAdminUsers fetches the users list with auth", () => {
		fetchAdminUsers();
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/users");
		expect(useFetchCalls[0].options.headers).toEqual({ Authorization: "Bearer test-token" });
	});

	it("createAdminUser sends POST with credentials", () => {
		createAdminUser({ username: "alice", password: "secret" });
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/users");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.body).toEqual({ username: "alice", password: "secret" });
	});

	it("deleteAdminUser sends DELETE with ID", () => {
		deleteAdminUser(9);
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/users/9");
		expect(useFetchCalls[0].options.method).toBe("DELETE");
	});
});

describe("notifyPushSubscribers", () => {
	beforeEach(() => {
		Object.defineProperty(window, "localStorage", {
			value: {
				getItem: vi.fn(() => "test-token"),
				setItem: vi.fn(),
				removeItem: vi.fn(),
			},
			writable: true,
		});
	});

	it("posts a notification to the push endpoint with auth", () => {
		notifyPushSubscribers({ title: "New post", body: "Check it out", url: "/posts/x" });
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/push/notify");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.body).toEqual({
			title: "New post",
			body: "Check it out",
			url: "/posts/x",
		});
		expect(useFetchCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
		});
	});
});

describe("adminLogin", () => {
	it("posts to the correct /api/admin/login URL with full baseURL", () => {
		adminLogin("admin", "secret");
		expect(useFetchCalls[0].url).toBe("http://localhost:18888/api/admin/login");
		expect(useFetchCalls[0].options.method).toBe("POST");
	});

	it("sends credentials as form-urlencoded body", () => {
		adminLogin("myuser", "mypass");
		const body = useFetchCalls[0].options.body as URLSearchParams;
		expect(body.get("username")).toBe("myuser");
		expect(body.get("password")).toBe("mypass");
	});

	it("sets the Content-Type header to application/x-www-form-urlencoded", () => {
		adminLogin("admin", "pass");
		const headers = useFetchCalls[0].options.headers as Record<string, string>;
		expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
	});
});

describe("admin auth header edge cases (getAuthHeaders)", () => {
	it("omits the Authorization header when no admin token is stored", () => {
		vi.stubGlobal("localStorage", {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		});
		fetchAdminPosts();
		expect(useFetchCalls[0].options.headers).toEqual({});
	});

	it("omits the Authorization header when localStorage is unavailable (SSR)", () => {
		vi.stubGlobal("localStorage", undefined);
		fetchAdminPosts();
		expect(useFetchCalls[0].options.headers).toEqual({});
	});

	it("omits the Authorization header when localStorage lacks getItem", () => {
		// Partial localStorage polyfills on some Node SSR runtimes must not
		// crash admin fetches (guard checks typeof getItem === "function").
		vi.stubGlobal("localStorage", {});
		fetchAdminPosts();
		expect(useFetchCalls[0].options.headers).toEqual({});
	});
});

describe("reader reading-history position API (TASK-200)", () => {
	it("fetchReaderReadingPosition GETs the per-post position URL", async () => {
		await fetchReaderReadingPosition(7);
		const call = $fetchCalls[$fetchCalls.length - 1];
		expect(call.url).toBe("http://localhost:18888/api/reader/me/history/7");
		expect(call.options.method ?? "GET").toBe("GET"); // absent method = GET
	});

	it("recordReaderHistory POSTs with no body when no position is given", async () => {
		await recordReaderHistory(7);
		const call = $fetchCalls[$fetchCalls.length - 1];
		expect(call.url).toBe("http://localhost:18888/api/reader/me/history/7");
		expect(call.options.method).toBe("POST");
		expect(call.options.body).toBeUndefined();
	});

	it("recordReaderHistory includes scroll_position in the body when saving", async () => {
		await recordReaderHistory(7, 850);
		const call = $fetchCalls[$fetchCalls.length - 1];
		expect(call.options.method).toBe("POST");
		expect(call.options.body).toEqual({ scroll_position: 850 });
	});

	it("recordReaderHistory sends an explicit zero to clear the position", async () => {
		await recordReaderHistory(7, 0);
		const call = $fetchCalls[$fetchCalls.length - 1];
		expect(call.options.body).toEqual({ scroll_position: 0 });
	});
});
