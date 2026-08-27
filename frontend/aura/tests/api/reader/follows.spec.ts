import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	followReaderCategory,
	followReaderSeries,
	followReaderTag,
	getReaderCategoryFollows,
	getReaderSeriesFollows,
	getReaderTagFollows,
	setCategoryFollowNotify,
	setSeriesFollowNotify,
	setTagFollowNotify,
	unfollowReaderCategory,
	unfollowReaderSeries,
	unfollowReaderTag,
	useReaderCategoryFollows,
	useReaderFollowsFeed,
	useReaderSeriesFollows,
	useReaderTagFollows,
} from "../../../api/reader/follows.ts";

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
		getItem: (key: string) => (key === "reader_token" ? "reader-jwt" : null),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("reader follow queries", () => {
	it("fetches the follows feed reactively", () => {
		useReaderFollowsFeed(9);

		expect(queryCalls[0].path).toBe("/api/reader/me/follows-feed");
		expect(queryCalls[0].options.query).toEqual({ limit: 9 });
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});

	it("fetches series follows reactively", () => {
		useReaderSeriesFollows();

		expect(queryCalls[0].path).toBe("/api/reader/me/series-follows");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("fetches category follows reactively", () => {
		useReaderCategoryFollows();

		expect(queryCalls[0].path).toBe("/api/reader/me/category-follows");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});
});

describe("reader follow commands", () => {
	it("follows a series with PUT", async () => {
		await followReaderSeries(5);

		expect(commandCalls[0].path).toBe("/api/reader/me/series/5/follow");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("toggles series notify with PATCH + body", async () => {
		await setSeriesFollowNotify(5, false);

		expect(commandCalls[0].path).toBe("/api/reader/me/series/5/follow");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ notify: false });
	});

	it("unfollows a series with DELETE", async () => {
		await unfollowReaderSeries(5);

		expect(commandCalls[0].path).toBe("/api/reader/me/series/5/follow");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});

	it("follows a category with PUT", async () => {
		await followReaderCategory(8);

		expect(commandCalls[0].path).toBe("/api/reader/me/categories/8/follow");
		expect(commandCalls[0].options.method).toBe("PUT");
	});

	it("toggles category notify with PATCH + body", async () => {
		await setCategoryFollowNotify(8, true);

		expect(commandCalls[0].path).toBe("/api/reader/me/categories/8/follow");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ notify: true });
	});

	it("unfollows a category with DELETE", async () => {
		await unfollowReaderCategory(8);

		expect(commandCalls[0].path).toBe("/api/reader/me/categories/8/follow");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});
});

describe("reader tag follow API (DEC-195)", () => {
	it("fetches tag follows reactively", () => {
		useReaderTagFollows();

		expect(queryCalls[0].path).toBe("/api/reader/me/tag-follows");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("follows a tag with PUT", async () => {
		await followReaderTag(3);

		expect(commandCalls[0].path).toBe("/api/reader/me/tags/3/follow");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("toggles tag notify with PATCH + body", async () => {
		await setTagFollowNotify(3, false);

		expect(commandCalls[0].path).toBe("/api/reader/me/tags/3/follow");
		expect(commandCalls[0].options.method).toBe("PATCH");
		expect(commandCalls[0].options.body).toEqual({ notify: false });
	});

	it("unfollows a tag with DELETE", async () => {
		await unfollowReaderTag(3);

		expect(commandCalls[0].path).toBe("/api/reader/me/tags/3/follow");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});
});

describe("reader follow GET commands ($fetch seam for onMounted, ISS-110/111 pattern)", () => {
	it("fetches series follows imperatively", async () => {
		await getReaderSeriesFollows();

		expect(commandCalls[0].path).toBe("/api/reader/me/series-follows");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("fetches category follows imperatively", async () => {
		await getReaderCategoryFollows();

		expect(commandCalls[0].path).toBe("/api/reader/me/category-follows");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});

	it("fetches tag follows imperatively", async () => {
		await getReaderTagFollows();

		expect(commandCalls[0].path).toBe("/api/reader/me/tag-follows");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer reader-jwt" });
	});
});
