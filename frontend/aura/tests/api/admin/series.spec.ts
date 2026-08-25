import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	createAdminSeries,
	deleteAdminSeries,
	getAdminSeriesEpisodes,
	reorderAdminSeriesEpisodes,
	updateAdminSeries,
	useAdminSeries,
} from "../../../api/admin/series";

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

describe("admin series queries", () => {
	it("lists series reactively with admin headers on the public path", () => {
		useAdminSeries();

		expect(queryCalls[0].path).toBe("/api/series");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});
});

describe("admin series commands", () => {
	it("creates a series with a POST body", async () => {
		await createAdminSeries({ title: "Deep Dive", slug: "deep-dive", description: null });

		expect(commandCalls[0].path).toBe("/api/series");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({
			title: "Deep Dive",
			slug: "deep-dive",
			description: null,
		});
		expect(commandCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer admin-jwt",
		});
	});

	it("updates a series with PUT", async () => {
		await updateAdminSeries(3, { title: "Renamed" });

		expect(commandCalls[0].path).toBe("/api/series/3");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.body).toEqual({ title: "Renamed" });
	});

	it("deletes a series with DELETE", async () => {
		await deleteAdminSeries(3);

		expect(commandCalls[0].path).toBe("/api/series/3");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});

	it("loads a series' episodes imperatively", async () => {
		await getAdminSeriesEpisodes(3);

		expect(commandCalls[0].path).toBe("/api/series/3/episodes");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});

	it("reorders episodes with PUT and an explicit id list", async () => {
		await reorderAdminSeriesEpisodes(3, [9, 7]);

		expect(commandCalls[0].path).toBe("/api/series/3/episodes/reorder");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.body).toEqual({ post_ids: [9, 7] });
	});
});
