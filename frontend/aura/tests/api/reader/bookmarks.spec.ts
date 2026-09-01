import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	addReaderBookmark,
	assignBookmarkFolder,
	createReaderBookmarkFolder,
	deleteReaderBookmarkFolder,
	getReaderBookmarkFolders,
	getReaderBookmarks,
	removeReaderBookmark,
	renameReaderBookmarkFolder,
	useReaderBookmarkFolders,
	useReaderBookmarks,
} from "../../../api/reader/bookmarks.ts";

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

describe("reader bookmark queries", () => {
	it("fetches the bookmarks list reactively with the reader audience headers", () => {
		useReaderBookmarks();

		expect(queryCalls[0]).toEqual({
			path: "/api/reader/me/bookmarks",
			options: {
				baseURL: "https://api.example.test",
				query: { folder_id: undefined },
				headers: { Authorization: "Bearer reader-jwt" },
				server: false,
				onResponseError: expect.any(Function),
			},
		});
	});

	it("passes the folder filter through to the bookmarks list", () => {
		useReaderBookmarks(3);

		expect(queryCalls[0].options.query).toEqual({ folder_id: 3 });
	});

	it("fetches bookmark folders reactively", () => {
		useReaderBookmarkFolders();

		expect(queryCalls[0].path).toBe("/api/reader/me/bookmarks/folders");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});
});

describe("reader bookmark commands", () => {
	it("fetches the bookmarks list imperatively with reader headers", async () => {
		await getReaderBookmarks(2);

		expect(commandCalls[0]).toEqual({
			path: "/api/reader/me/bookmarks",
			options: {
				baseURL: "https://api.example.test",
				query: { folder_id: 2 },
				headers: { Authorization: "Bearer reader-jwt" },
			},
		});
	});

	it("fetches bookmark folders imperatively", async () => {
		await getReaderBookmarkFolders();

		expect(commandCalls[0].path).toBe("/api/reader/me/bookmarks/folders");
	});

	it("creates a bookmark folder with a POST body", async () => {
		await createReaderBookmarkFolder("Reading list");

		expect(commandCalls[0]).toEqual({
			path: "/api/reader/me/bookmarks/folders",
			options: {
				baseURL: "https://api.example.test",
				method: "POST",
				headers: {
					Authorization: "Bearer reader-jwt",
					"Content-Type": "application/json",
				},
				body: { name: "Reading list" },
			},
		});
	});

	it("renames a bookmark folder with a PATCH body", async () => {
		await renameReaderBookmarkFolder(4, "Later");

		expect(commandCalls[0].path).toBe("/api/reader/me/bookmarks/folders/4");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ name: "Later" });
	});

	it("deletes a bookmark folder with DELETE", async () => {
		await deleteReaderBookmarkFolder(4);

		expect(commandCalls[0].path).toBe("/api/reader/me/bookmarks/folders/4");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});

	it("files a bookmark into a folder with a PATCH body", async () => {
		await assignBookmarkFolder(9, 4);

		expect(commandCalls[0].path).toBe("/api/reader/me/bookmarks/9/folder");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ folder_id: 4 });
	});

	it("adds a bookmark with an idempotent PUT", async () => {
		await addReaderBookmark(9);

		expect(commandCalls[0].path).toBe("/api/reader/me/bookmarks/9");
		expect(commandCalls[0].options.method).toBe("PUT");
	});

	it("removes a bookmark with DELETE", async () => {
		await removeReaderBookmark(9);

		expect(commandCalls[0].path).toBe("/api/reader/me/bookmarks/9");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});
});
