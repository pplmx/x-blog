import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	createAdminCategory,
	createAdminTag,
	deleteAdminCategory,
	deleteAdminTag,
	updateAdminCategory,
	updateAdminTag,
	useAdminCategories,
	useAdminTags,
} from "../../../api/admin/taxonomy";

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

describe("admin taxonomy queries", () => {
	it("lists categories reactively with admin headers", () => {
		useAdminCategories();

		expect(queryCalls[0].path).toBe("/api/admin/categories");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});

	it("lists tags reactively with admin headers", () => {
		useAdminTags();

		expect(queryCalls[0].path).toBe("/api/admin/tags");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});
});

describe("admin taxonomy commands", () => {
	it("creates a category with a POST name body", async () => {
		await createAdminCategory("随笔");

		expect(commandCalls[0].path).toBe("/api/admin/categories");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({ name: "随笔" });
		expect(commandCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer admin-jwt",
		});
	});

	it("renames a category with PUT", async () => {
		await updateAdminCategory(3, "随笔");

		expect(commandCalls[0].path).toBe("/api/admin/categories/3");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.body).toEqual({ name: "随笔" });
	});

	it("deletes a category with DELETE", async () => {
		await deleteAdminCategory(3);

		expect(commandCalls[0].path).toBe("/api/admin/categories/3");
		expect(commandCalls[0].options.method).toBe("DELETE");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});

	it("creates a tag with a POST name body", async () => {
		await createAdminTag("vue");

		expect(commandCalls[0].path).toBe("/api/admin/tags");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({ name: "vue" });
	});

	it("renames a tag with PUT", async () => {
		await updateAdminTag(7, "nuxt");

		expect(commandCalls[0].path).toBe("/api/admin/tags/7");
		expect(commandCalls[0].options.method).toBe("PUT");
		expect(commandCalls[0].options.body).toEqual({ name: "nuxt" });
	});

	it("deletes a tag with DELETE", async () => {
		await deleteAdminTag(7);

		expect(commandCalls[0].path).toBe("/api/admin/tags/7");
		expect(commandCalls[0].options.method).toBe("DELETE");
	});
});
