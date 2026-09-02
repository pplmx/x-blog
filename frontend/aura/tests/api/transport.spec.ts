import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { command, query, withQuery } from "../../api/transport.ts";
import { useRateLimitNotice } from "../../composables/useRateLimitNotice";

let useFetchCalls: Array<{
	path: unknown;
	options: Record<string, unknown>;
}>;
let commandCalls: Array<{
	path: string;
	options: Record<string, unknown>;
}>;

beforeEach(() => {
	useFetchCalls = [];
	commandCalls = [];

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl: "https://api.example.test" },
	}));
	vi.stubGlobal(
		"useFetch",
		vi.fn((path: unknown, options: Record<string, unknown> = {}) => {
			useFetchCalls.push({ path, options });
			return { data: null, error: null };
		}),
	);
	vi.stubGlobal("$fetch", ((path: string, options: Record<string, unknown> = {}) => {
		commandCalls.push({ path, options });
		return Promise.resolve({ ok: true });
	}) as Mock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("query", () => {
	it("resolves the API base URL and forwards query options", () => {
		const options = { query: { page: 2 }, server: false };

		query("/api/posts", options);

		expect(useFetchCalls).toEqual([
			{
				path: "/api/posts",
				options: {
					baseURL: "https://api.example.test",
					query: { page: 2 },
					server: false,
					// transport adds a 429 rate-limit detector to every query
					onResponseError: expect.any(Function),
				},
			},
		]);
	});

	it("forwards a reactive path getter unchanged", () => {
		const path = () => "/api/posts/current";

		query(path);

		expect(useFetchCalls[0].path).toBe(path);
	});

	it("returns the exact object produced by useFetch", () => {
		const result = query("/api/posts");

		expect(result).toBe((useFetch as Mock).mock.results[0]?.value);
	});
});

describe("command", () => {
	it("uses imperative $fetch with the configured API base URL", async () => {
		const result = await command<{ ok: boolean }>("/api/posts/7");

		expect(result).toEqual({ ok: true });
		expect(commandCalls).toEqual([
			{
				path: "/api/posts/7",
				options: { baseURL: "https://api.example.test" },
			},
		]);
	});

	it("forwards method, headers, and body", async () => {
		const body = { title: "New post" };
		const headers = { Authorization: "Bearer token", "Content-Type": "application/json" };

		await command("/api/posts", { method: "POST", headers, body });

		expect(commandCalls[0].options).toEqual({
			baseURL: "https://api.example.test",
			method: "POST",
			headers,
			body,
		});
	});
});

describe("rate-limit notice wiring", () => {
	beforeEach(() => {
		// The notice is a module-level singleton shared across calls; reset it so
		// later tests don't observe a flag flipped (or timer left running) by an
		// earlier one.
		useRateLimitNotice().dismiss();
	});

	it("command raises the app-wide notice when a 429 response arrives", async () => {
		const notifier = useRateLimitNotice();
		vi.stubGlobal(
			"$fetch",
			vi.fn(async () => {
				const err = new Error("Rate limit exceeded") as Error & { response: { status: number } };
				err.response = { status: 429 };
				throw err;
			}),
		);

		await expect(command("/api/comments/post/1")).rejects.toThrow("Rate limit exceeded");

		expect(notifier.active.value).toBe(true);
	});

	it("command leaves the notice off on a non-429 failure", async () => {
		const notifier = useRateLimitNotice();
		vi.stubGlobal(
			"$fetch",
			vi.fn(async () => {
				const err = new Error("boom") as Error & { response: { status: number } };
				err.response = { status: 503 };
				throw err;
			}),
		);

		await expect(command("/api/search")).rejects.toThrow("boom");

		expect(notifier.active.value).toBe(false);
	});

	it("command success does not trigger the notice", async () => {
		const notifier = useRateLimitNotice();
		vi.stubGlobal(
			"$fetch",
			vi.fn(async () => ({ ok: true })),
		);

		await expect(command("/api/posts")).resolves.toEqual({ ok: true });

		expect(notifier.active.value).toBe(false);
	});

	it("query registers a 429 detector that flips the notice", async () => {
		const notifier = useRateLimitNotice();
		query("/api/posts");

		const onResponseError = useFetchCalls[0].options.onResponseError as (ctx: {
			response: { status: number };
		}) => unknown;
		await onResponseError({ response: { status: 429 } });

		expect(notifier.active.value).toBe(true);
	});
});

describe("admin session-expiry 401 handling (ISS-277)", () => {
	beforeEach(() => {
		vi.restoreAllMocks(); // a prior test's replace spy must not leak its call count
		localStorage.clear();
		vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("command hard-redirects to /admin/login on a 401 from an admin endpoint", async () => {
		localStorage.setItem("admin_token", "admin-jwt");
		vi.stubGlobal(
			"$fetch",
			vi.fn(async () => {
				const err = new Error("Unauthorized") as Error & { response: { status: number } };
				err.response = { status: 401 };
				throw err;
			}),
		);

		await expect(command("/api/admin/posts")).rejects.toThrow("Unauthorized");

		expect(localStorage.getItem("admin_token")).toBeNull();
		expect(window.location.replace).toHaveBeenCalledWith("/admin/login");
	});

	it("does NOT redirect for a 401 on a reader endpoint (reader pages handle it)", async () => {
		localStorage.setItem("admin_token", "admin-jwt");
		vi.stubGlobal(
			"$fetch",
			vi.fn(async () => {
				const err = new Error("Unauthorized") as Error & { response: { status: number } };
				err.response = { status: 401 };
				throw err;
			}),
		);

		await expect(command("/api/reader/me/bookmarks")).rejects.toThrow("Unauthorized");

		expect(localStorage.getItem("admin_token")).toBe("admin-jwt");
		expect(window.location.replace).not.toHaveBeenCalled();
	});

	it("does NOT redirect for a 401 from /api/admin/login (invalid credentials)", async () => {
		localStorage.setItem("admin_token", "admin-jwt");
		vi.stubGlobal(
			"$fetch",
			vi.fn(async () => {
				const err = new Error("Unauthorized") as Error & { response: { status: number } };
				err.response = { status: 401 };
				throw err;
			}),
		);

		await expect(command("/api/admin/login")).rejects.toThrow("Unauthorized");

		// The token is not the login failure — it stays; the login page shows
		// its own "invalid credentials" error in place.
		expect(localStorage.getItem("admin_token")).toBe("admin-jwt");
		expect(window.location.replace).not.toHaveBeenCalled();
	});

	it("does NOT touch the session on a non-401 admin failure", async () => {
		localStorage.setItem("admin_token", "admin-jwt");
		vi.stubGlobal(
			"$fetch",
			vi.fn(async () => {
				const err = new Error("boom") as Error & { response: { status: number } };
				err.response = { status: 503 };
				throw err;
			}),
		);

		await expect(command("/api/admin/posts")).rejects.toThrow("boom");

		expect(localStorage.getItem("admin_token")).toBe("admin-jwt");
		expect(window.location.replace).not.toHaveBeenCalled();
	});

	it("query redirects on a 401 from an admin path (getter-backed reactive path)", async () => {
		localStorage.setItem("admin_token", "admin-jwt");
		query(() => "/api/admin/posts?q=vue");

		const onResponseError = useFetchCalls[0].options.onResponseError as (ctx: {
			response: { status: number };
		}) => unknown;
		await onResponseError({ response: { status: 401 } });

		expect(localStorage.getItem("admin_token")).toBeNull();
		expect(window.location.replace).toHaveBeenCalledWith("/admin/login");
	});
});

describe("withQuery", () => {
	it("omits nullish and empty values while preserving zero and false", () => {
		expect(withQuery("/api/x", { zero: 0, off: false, empty: "", none: null })).toBe(
			"/api/x?zero=0&off=false",
		);
	});

	it("encodes query keys and values with URLSearchParams", () => {
		expect(withQuery("/api/search", { "topic name": "Nuxt & Vue", page: 1 })).toBe(
			"/api/search?topic+name=Nuxt+%26+Vue&page=1",
		);
	});

	it("does not append a question mark when every value is omitted", () => {
		expect(withQuery("/api/x", { empty: "", missing: undefined, none: null })).toBe("/api/x");
	});
});
