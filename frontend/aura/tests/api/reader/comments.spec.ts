import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { deleteMyComment, getMyComments, updateMyComment } from "../../../api/reader/comments.ts";

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
		getItem: (key: string) => (key === "reader_token" ? "reader-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("reader my-comment commands", () => {
	it("lists the reader's own comments with status filter and pagination", async () => {
		await getMyComments("pending", 2, 10);

		expect(commandCalls[0].path).toBe("/api/reader/me/comments");
		expect(commandCalls[0].options.query).toEqual({ status: "pending", page: 2, limit: 10 });
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("deletes a comment with DELETE", async () => {
		await deleteMyComment(50);

		expect(commandCalls[0].path).toBe("/api/reader/me/comments/50");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});

	it("updates a comment with a PATCH content body", async () => {
		await updateMyComment(50, "edited body");

		expect(commandCalls[0].path).toBe("/api/reader/me/comments/50");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ content: "edited body" });
	});
});
