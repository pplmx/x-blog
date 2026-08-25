import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminLogin } from "../../../api/admin/auth";

let queryCalls: Array<{ path: unknown; options: Record<string, unknown> }>;

beforeEach(() => {
	queryCalls = [];
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
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("admin auth", () => {
	it("logs in against /api/admin/login as a form-urlencoded POST", () => {
		adminLogin("root", "hunter2");

		expect(queryCalls[0].path).toBe("/api/admin/login");
		expect(queryCalls[0].options.method).toBe("POST");
		const headers = queryCalls[0].options.headers as Record<string, string>;
		expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
		const body = queryCalls[0].options.body as URLSearchParams;
		expect(body).toBeInstanceOf(URLSearchParams);
		expect(body.get("username")).toBe("root");
		expect(body.get("password")).toBe("hunter2");
	});
});
