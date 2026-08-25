import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	approveAdminComment,
	batchApproveAdminComments,
	batchDeleteAdminComments,
	deleteAdminComment,
	dismissAdminCommentFlags,
	getAdminComments,
} from "../../../api/admin/comments";

let commandCalls: Array<{ path: string; options: Record<string, unknown> }>;

beforeEach(() => {
	commandCalls = [];
	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
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

describe("admin comment queries", () => {
	it("lists comments with page/limit and admin headers", async () => {
		await getAdminComments({}, 2, 20);

		expect(commandCalls[0].path).toBe("/api/admin/comments?page=2&limit=20");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});

	it("passes moderation filters through", async () => {
		await getAdminComments({ postId: 3, isApproved: false, q: "hello", flagged: true });

		expect(commandCalls[0].path).toBe(
			"/api/admin/comments?post_id=3&is_approved=false&q=hello&flagged=true&page=1&limit=20",
		);
	});

	it("omits unset filters", async () => {
		await getAdminComments({ q: "" });

		expect(commandCalls[0].path).toBe("/api/admin/comments?page=1&limit=20");
	});
});

describe("admin comment commands", () => {
	it("approves a comment with PATCH", async () => {
		await approveAdminComment(25, true);

		expect(commandCalls[0].path).toBe("/api/comments/25/approve");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ approved: true });
		expect(commandCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer admin-jwt",
		});
	});

	it("deletes a comment with DELETE", async () => {
		await deleteAdminComment(25);

		expect(commandCalls[0].path).toBe("/api/admin/comments/25");
		expect(commandCalls[0].options.method).toBe("DELETE");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});

	it("dismisses a comment's flags with DELETE", async () => {
		await dismissAdminCommentFlags(25);

		expect(commandCalls[0].path).toBe("/api/admin/comments/25/flags");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});

	it("batch-deletes selected comments", async () => {
		await batchDeleteAdminComments([1, 2, 3]);

		expect(commandCalls[0].path).toBe("/api/admin/comments/batch-delete");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({ ids: [1, 2, 3] });
	});

	it("batch-approves or rejects selected comments", async () => {
		await batchApproveAdminComments([1, 2], true);

		expect(commandCalls[0].path).toBe("/api/admin/comments/batch-approve");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({ ids: [1, 2], approved: true });
	});
});
