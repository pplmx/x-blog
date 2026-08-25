import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
	createAdminUser,
	deleteAdminUser,
	useAdminUsers,
	useCurrentAdmin,
} from "../../../api/admin/users";

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

describe("admin user queries", () => {
	it("fetches the current admin reactively with admin headers", () => {
		useCurrentAdmin();

		expect(queryCalls[0].path).toBe("/api/admin/me");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});

	it("lists admin users reactively with admin headers", () => {
		useAdminUsers();

		expect(queryCalls[0].path).toBe("/api/admin/users");
		expect(queryCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
		expect(queryCalls[0].options.server).toBe(false);
	});
});

describe("admin user commands", () => {
	it("creates a user with a POST body", async () => {
		await createAdminUser({ username: "alice", password: "secret" });

		expect(commandCalls[0].path).toBe("/api/admin/users");
		expect(commandCalls[0].options.method).toBe("POST");
		expect(commandCalls[0].options.body).toEqual({ username: "alice", password: "secret" });
		expect(commandCalls[0].options.headers).toEqual({
			"Content-Type": "application/json",
			Authorization: "Bearer admin-jwt",
		});
	});

	it("deletes a user with DELETE", async () => {
		await deleteAdminUser(9);

		expect(commandCalls[0].path).toBe("/api/admin/users/9");
		expect(commandCalls[0].options.method).toBe("DELETE");
		expect(commandCalls[0].options.headers).toEqual({ Authorization: "Bearer admin-jwt" });
	});
});
