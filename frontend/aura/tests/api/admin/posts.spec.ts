import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	createAdminPost,
	deleteAdminPost,
	getAdminPost,
	getPostRevisions,
	restorePostRevision,
	updateAdminPost,
	useAdminPost,
	useAdminPosts,
	usePostRevisions,
} from "../../../api/admin/posts";

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
		return Promise.resolve({});
	}) as Mock);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => (key === "admin_token" ? "admin-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin post queries", () => {
	it("lists posts reactively with search/filter/pagination query", () => {
		useAdminPosts({ q: "vue", status: "published", skip: 20, limit: 10 });

		expect(queryCalls[0].path).toBe("/api/admin/posts?q=vue&status=published&skip=20&limit=10");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});

	it("omits empty list filters", () => {
		useAdminPosts();

		expect(queryCalls[0].path).toBe("/api/admin/posts");
	});

	it("fetches a post for editing reactively", () => {
		useAdminPost(42);

		expect(queryCalls[0].path).toBe("/api/admin/posts/42");
		expect(queryCalls[0].options.server).toBe(false);
	});

	it("lists post revisions reactively", () => {
		usePostRevisions(42);

		expect(queryCalls[0].path).toBe("/api/admin/posts/42/revisions");
		expect(queryCalls[0].options.server).toBe(false);
	});
});

describe("admin post command", () => {
	it("fetches a post imperatively", async () => {
		await getAdminPost(42);

		expect(commandCalls[0].path).toBe("/api/admin/posts/42");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});

	it("loads revision history imperatively", async () => {
		await getPostRevisions(42);

		expect(commandCalls[0].path).toBe("/api/admin/posts/42/revisions");
	});

	it("restores a revision with POST", async () => {
		await restorePostRevision(42, 7);

		expect(commandCalls[0].path).toBe("/api/admin/posts/42/revisions/7/restore");
		expect(commandCalls[0].options.method).toBe("POST");
	});

	it("creates a post with a POST body", async () => {
		await createAdminPost({ title: "T", slug: "t", content: "# c", published: false });

		expect(commandCalls[0].path).toBe("/api/admin/posts");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({
			title: "T",
			slug: "t",
			content: "# c",
			published: false,
		});
		expect(commandCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer admin-jwt",
		});
	});

	it("updates a post with PUT", async () => {
		await updateAdminPost(10, { title: "Updated" });

		expect(commandCalls[0].path).toBe("/api/admin/posts/10");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.body).toEqual({ title: "Updated" });
	});

	it("deletes a post with DELETE", async () => {
		await deleteAdminPost(5);

		expect(commandCalls[0].path).toBe("/api/admin/posts/5");
		expect(commandCalls[0].options.method).toBe("DELETE");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});
});
