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
	fetchCurrentAdmin,
	fetchReaderReadingPosition,
	notifyPushSubscribers,
	recordReaderHistory,
	updateAdminCategory,
	updateAdminPost,
	updateAdminSeries,
	updateAdminTag,
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
