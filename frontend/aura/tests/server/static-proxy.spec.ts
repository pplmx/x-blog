/**
 * Static file proxy server route tests.
 *
 * Tests the server route that proxies /static/* requests to the backend.
 * This route is needed because uploaded images return backend-relative
 * URLs (e.g. /static/uploads/2024/07/image.jpg) that would 404 through
 * the Nuxt frontend without a proxy.
 *
 * Stubs the global fetch to verify:
 * - Correct backend URL construction including the /static/ prefix
 * - Response forwarding (status code, headers, body)
 * - Error handling when backend is unavailable
 */

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Stub Nuxt globals before any route imports
vi.stubGlobal("defineEventHandler", (fn: (event: any) => any) => fn);

interface MockResponse {
	status: number;
	headers: Map<string, string>;
	arrayBuffer: Mock;
}

interface FetchCall {
	url: string;
}

let fetchCalls: FetchCall[];
let mockFetch: Mock;
let mockSetResponseStatus: Mock;
let mockSetResponseHeader: Mock;
const backendUrl = "http://localhost:18888";

beforeEach(() => {
	fetchCalls = [];

	mockFetch = vi.fn((url: string) => {
		fetchCalls.push({ url });
		const headers = new Map<string, string>([
			["content-type", "image/jpeg"],
			["cache-control", "public, max-age=86400"],
		]);
		const mockResponse: MockResponse = {
			status: 200,
			headers,
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
		};
		return Promise.resolve(mockResponse);
	}) as Mock;

	globalThis.fetch = mockFetch as unknown as typeof fetch;

	mockSetResponseStatus = vi.fn();
	mockSetResponseHeader = vi.fn();
	vi.stubGlobal("setResponseStatus", mockSetResponseStatus);
	vi.stubGlobal("setResponseHeader", mockSetResponseHeader);

	vi.stubGlobal("getRouterParam", (_event: any, param: string) => {
		if (param === "path") return "uploads/2024/07/test-image.jpg";
		return "";
	});

	vi.stubGlobal("getHeaders", () => ({
		host: "localhost",
		connection: "keep-alive",
	}));

	vi.stubGlobal("createError", (opts: Record<string, unknown>) => {
		const err = new Error(opts.statusMessage as string);
		Object.assign(err, opts);
		return err;
	});
});

// Use vi.hoisted to load the route handler after globals are stubbed
const { loadHandler } = vi.hoisted(() => ({
	loadHandler: () => {
		vi.stubGlobal("defineEventHandler", (fn: (event: any) => any) => fn);
		vi.stubGlobal("getRouterParam", (_event: any, param: string) => {
			if (param === "path") return "uploads/2024/07/test-image.jpg";
			return "";
		});
		vi.stubGlobal("getHeaders", () => ({ host: "localhost" }));
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require("/workspace/x-blog/frontend/aura/server/routes/static/[...path].ts").default;
	},
}));

describe("Static file proxy", () => {
	it("forwards /static/* requests to the backend with correct URL", async () => {
		const handler = loadHandler();
		await handler({});

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(`${backendUrl}/static/uploads/2024/07/test-image.jpg`);
	});

	it("returns the response body as a Buffer", async () => {
		mockFetch.mockResolvedValue({
			status: 200,
			headers: new Map([["content-type", "image/png"]]),
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
		});

		const handler = loadHandler();
		const result = await handler({});

		expect(Buffer.isBuffer(result)).toBe(true);
	});

	it("sets response status from backend response", async () => {
		mockFetch.mockResolvedValue({
			status: 200,
			headers: new Map([["content-type", "image/jpeg"]]),
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(5)),
		});

		const handler = loadHandler();
		await handler({});

		expect(mockSetResponseStatus).toHaveBeenCalledWith({}, 200);
	});

	it("forwards content-type header from backend", async () => {
		mockFetch.mockResolvedValue({
			status: 200,
			headers: new Map([["content-type", "image/png"]]),
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(5)),
		});

		const handler = loadHandler();
		await handler({});

		// setResponseHeader is called as (event, key, value)
		const headerNames = mockSetResponseHeader.mock.calls.map((call: any[]) => call[1]);
		expect(headerNames).toContain("content-type");
	});

	it("skips content-encoding and transfer-encoding headers", async () => {
		mockFetch.mockResolvedValue({
			status: 200,
			headers: new Map([
				["content-type", "image/jpeg"],
				["content-encoding", "gzip"],
				["transfer-encoding", "chunked"],
			]),
			arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(5)),
		});

		const handler = loadHandler();
		await handler({});

		const headerNames = mockSetResponseHeader.mock.calls.map((call: any[]) => call[1]);
		expect(headerNames).not.toContain("content-encoding");
		expect(headerNames).not.toContain("transfer-encoding");
		expect(headerNames).toContain("content-type");
	});

	it("returns 502 when backend is unavailable", async () => {
		mockFetch.mockRejectedValue(new Error("Connection refused"));

		const handler = loadHandler();
		await expect(handler({})).rejects.toThrow("Backend unavailable");
	});
});

describe("Static file proxy security", () => {
	it("rejects path traversal attempts", async () => {
		// loadHandler() re-stubs getRouterParam to the safe path; override
		// AFTER loading so the handler sees the malicious value.
		const handler = loadHandler();
		vi.stubGlobal("getRouterParam", (_event: any, param: string) => {
			if (param === "path") return "../api/categories";
			return "";
		});

		await expect(handler({})).rejects.toThrow("Invalid static path");
		expect(fetchCalls).toHaveLength(0);
	});

	it("rejects encoded traversal attempts", async () => {
		const handler = loadHandler();
		vi.stubGlobal("getRouterParam", (_event: any, param: string) => {
			if (param === "path") return "..%2Fapi%2Fcategories";
			return "";
		});

		await expect(handler({})).rejects.toThrow("Invalid static path");
		expect(fetchCalls).toHaveLength(0);
	});

	it("does not forward authorization headers", async () => {
		const handler = loadHandler();
		vi.stubGlobal("getHeaders", () => ({
			host: "localhost",
			authorization: "Bearer admin-token",
			"cache-control": "max-age=3600",
		}));

		await handler({});

		const forwardedHeaders = mockFetch.mock.calls[0][1] as { headers: Record<string, string> };
		expect(forwardedHeaders.headers.authorization).toBeUndefined();
		expect(forwardedHeaders.headers["cache-control"]).toBe("max-age=3600");
	});
});
