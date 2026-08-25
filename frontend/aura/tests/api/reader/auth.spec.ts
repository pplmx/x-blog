import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { readerLogin, readerRegister } from "../../../api/reader/auth.ts";

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
	vi.stubGlobal("$fetch", (() => Promise.resolve({ ok: true })) as Mock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("reader auth queries", () => {
	it("registers a reader through an imperative setup POST query", () => {
		readerRegister({ email: "new@example.test", password: "secret", display_name: "Ana" });

		expect(queryCalls[0].path).toBe("/api/reader/register");
		const options = queryCalls[0].options;
		expect(options.baseURL).toBe("https://api.example.test");
		expect(options.method).toBe("POST");
		expect(options.body).toEqual({
			email: "new@example.test",
			password: "secret",
			display_name: "Ana",
		});
		expect(options.server).toBe(false);
		expect(options.headers).toEqual({ "Content-Type": "application/json" });
	});

	it("logs a reader in through the same setup POST query", () => {
		readerLogin({ email: "ana@example.test", password: "secret" });

		expect(queryCalls[0].path).toBe("/api/reader/login");
		expect(queryCalls[0].options.method).toBe("POST");
		expect(queryCalls[0].options.body).toEqual({ email: "ana@example.test", password: "secret" });
		expect(queryCalls[0].options.server).toBe(false);
	});
});
