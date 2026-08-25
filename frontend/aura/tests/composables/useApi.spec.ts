/**
 * API composable tests
 * Tests useApi, usePosts, useCategories, useTags composables.
 * Mocks Nuxt's useFetch and useRuntimeConfig to verify URL construction,
 * base URL configuration, and query parameter building.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	approveAdminComment,
	batchApproveAdminComment,
	deleteAdminComment,
	fetchAdminComments,
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
