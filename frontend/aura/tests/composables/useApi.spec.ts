/**
 * API composable tests
 * Tests useApi, usePosts, useCategories, useTags composables.
 * Mocks Nuxt's useFetch and useRuntimeConfig to verify URL construction,
 * base URL configuration, and query parameter building.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	adminLogin,
	createComment,
	fetchComments,
	useApi,
	useCategories,
	usePopularPosts,
	usePost,
	usePostLike,
	usePosts,
	usePostView,
	useRelatedPosts,
	useSearch,
	useTags,
} from "../../composables/useApi.ts";

// Capture what useFetch is called with
let useFetchCalls: Array<{
	url: string;
	options: Record<string, unknown>;
}>;

beforeEach(() => {
	useFetchCalls = [];

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
});

afterEach(() => {
	vi.unstubAllGlobals();
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
	it("posts to the view increment endpoint", () => {
		usePostView(42);
		expect(useFetchCalls[0].url).toBe("/api/posts/42/view");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("uses the correct baseURL from config", () => {
		usePostView(1);
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});
});

describe("usePostLike", () => {
	it("posts to the like increment endpoint", () => {
		usePostLike(42);
		expect(useFetchCalls[0].url).toBe("/api/posts/42/like");
		expect(useFetchCalls[0].options.method).toBe("POST");
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
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
		expect(useFetchCalls[0].options.query).toEqual({ page: 1, limit: 20 });
		expect(useFetchCalls[0].options.baseURL).toBe("http://localhost:18888");
	});

	it("accepts custom page and limit parameters", () => {
		fetchComments(10, 3, 5);
		expect(useFetchCalls[0].options.query).toEqual({ page: 3, limit: 5 });
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
