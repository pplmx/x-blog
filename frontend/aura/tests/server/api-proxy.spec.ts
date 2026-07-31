/**
 * API proxy server route tests.
 *
 * The /api/[...path] route proxies frontend API calls to the backend. These
 * tests verify the URL is built correctly INCLUDING the query string — a
 * regression test for the bug where ?page=2&q=... was silently dropped,
 * breaking pagination/search/filters for every client using the proxy.
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Stub Nuxt globals before any route imports
vi.stubGlobal("defineEventHandler", (fn: (event: any) => any) => fn);

let mockFetchRaw: Mock;
let mockSetResponseStatus: Mock;
let mockSetResponseHeader: Mock;
const backendUrl = "http://localhost:18888";

beforeEach(() => {
	mockFetchRaw = vi.fn().mockResolvedValue({
		status: 200,
		headers: { "content-type": "application/json" },
		_data: { ok: true },
	}) as Mock;

	vi.stubGlobal("$fetch", { raw: mockFetchRaw });

	mockSetResponseStatus = vi.fn();
	mockSetResponseHeader = vi.fn();
	vi.stubGlobal("setResponseStatus", mockSetResponseStatus);
	vi.stubGlobal("setResponseHeader", mockSetResponseHeader);

	vi.stubGlobal("getRouterParam", (_event: any, param: string) => {
		if (param === "path") return "posts";
		return "";
	});
	vi.stubGlobal("getMethod", () => "GET");
	vi.stubGlobal("getQuery", () => ({}));
	vi.stubGlobal("getHeaders", () => ({ host: "localhost" }));
	vi.stubGlobal("readRawBody", vi.fn().mockResolvedValue("raw-body"));
	vi.stubGlobal("getRequestHeader", () => "application/json");

	vi.stubGlobal("createError", (opts: Record<string, unknown>) => {
		const err = new Error(opts.statusMessage as string);
		Object.assign(err, opts);
		return err;
	});
});

// Load the route handler after globals are stubbed
const { loadHandler } = vi.hoisted(() => ({
	loadHandler: () => {
		vi.stubGlobal("defineEventHandler", (fn: (event: any) => any) => fn);
		vi.stubGlobal("getRouterParam", (_event: any, param: string) => {
			if (param === "path") return "posts";
			return "";
		});
		vi.stubGlobal("getMethod", () => "GET");
		vi.stubGlobal("getQuery", () => ({}));
		vi.stubGlobal("getHeaders", () => ({ host: "localhost" }));
		// Resolve the route file relative to this spec, so the tests work from
		// any checkout location (the previous absolute path only existed on the
		// dev machine and broke CI with MODULE_NOT_FOUND).
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const path = require("node:path");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require(path.resolve(__dirname, "../../server/routes/api/[...path].ts")).default;
	},
}));

describe("API proxy", () => {
	it("forwards requests to the backend with correct URL", async () => {
		const handler = loadHandler();
		await handler({});

		expect(mockFetchRaw).toHaveBeenCalledTimes(1);
		const [url] = mockFetchRaw.mock.calls[0] as [string];
		expect(url).toBe(`${backendUrl}/api/posts`);
	});

	it("forwards the query string to the backend", async () => {
		const handler = loadHandler();
		vi.stubGlobal("getQuery", () => ({ page: "2", limit: "2", q: "hello world" }));
		await handler({});

		const [url] = mockFetchRaw.mock.calls[0] as [string];
		expect(url).toBe(`${backendUrl}/api/posts?page=2&limit=2&q=hello+world`);
	});

	it("returns the backend response data", async () => {
		const handler = loadHandler();
		const result = await handler({});

		expect(result).toEqual({ ok: true });
	});

	it("forwards the backend response status", async () => {
		mockFetchRaw.mockResolvedValue({
			status: 201,
			headers: {},
			_data: { id: 1 },
		});

		const handler = loadHandler();
		await handler({});

		expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 201);
	});

	it("passes through backend error responses", async () => {
		mockFetchRaw.mockRejectedValue({
			response: { status: 422, _data: { error: "validation failed" } },
		});

		const handler = loadHandler();
		const result = await handler({});

		expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 422);
		expect(result).toEqual({ error: "validation failed" });
	});

	it("returns 502 when the backend is unreachable", async () => {
		mockFetchRaw.mockRejectedValue(new Error("ECONNREFUSED"));

		const handler = loadHandler();
		await expect(handler({})).rejects.toThrow("Backend unavailable");
	});
});

describe("API proxy request bodies", () => {
	it("passes form-urlencoded bodies through raw (regression: null-prototype objects)", async () => {
		const handler = loadHandler();
		// loadHandler re-stubs the route params; override after loading
		vi.stubGlobal("getRouterParam", (_event: any, param: string) =>
			param === "path" ? "admin/login" : "",
		);
		vi.stubGlobal("getMethod", () => "POST");
		vi.stubGlobal("getRequestHeader", () => "application/x-www-form-urlencoded");
		vi.stubGlobal("readRawBody", vi.fn().mockResolvedValue("username=admin&password=admin123"));
		await handler({});

		const [url, options] = mockFetchRaw.mock.calls[0] as [string, { body: unknown }];
		expect(url).toBe(`${backendUrl}/api/admin/login`);
		// The raw string is forwarded verbatim, not parsed+re-encoded (h3's
		// parsed form bodies are null-prototype objects that ofetch cannot
		// serialize, which 502'd every form POST).
		expect(options.body).toBe("username=admin&password=admin123");
	});

	it("does not read a body for GET requests", async () => {
		const handler = loadHandler();
		vi.stubGlobal("getMethod", () => "GET");
		const readRawBodyMock = vi.fn();
		vi.stubGlobal("readRawBody", readRawBodyMock);
		await handler({});

		expect(readRawBodyMock).not.toHaveBeenCalled();
	});
});
