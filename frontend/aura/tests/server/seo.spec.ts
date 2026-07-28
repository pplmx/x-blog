/**
 * Server route tests for SEO endpoints (robots.txt, sitemap.xml, RSS, Atom).
 * Tests the Nuxt server route handlers that proxy to the backend.
 * Stubs Nuxt globals (defineEventHandler, useRuntimeConfig, $fetch, createError)
 * to verify:
 * - Correct backend URL construction
 * - Proper Content-Type headers
 * - Error handling with createError
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Stub Nuxt globals before any imports
vi.stubGlobal("defineEventHandler", (fn: (event: any) => any) => fn);

interface FetchCall {
	url: string;
	options: Record<string, unknown>;
}

let fetchCalls: FetchCall[];
let mockFetch: Mock;
const apiUrl = "http://localhost:18888";

beforeEach(() => {
	fetchCalls = [];

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl },
	}));

	mockFetch = vi.fn((url: string, options: Record<string, unknown> = {}) => {
		fetchCalls.push({ url, options });
		return Promise.resolve("<xml>backend-content</xml>");
	}) as Mock;
	vi.stubGlobal("$fetch", mockFetch);

	vi.stubGlobal("createError", (opts: Record<string, unknown>) => {
		const err = new Error(opts.statusMessage as string);
		Object.assign(err, opts);
		return err;
	});
});

// Helper to call a route handler with a mock event
// Catches thrown errors so error-handling tests can inspect the result
async function callRoute(handler: (event: any) => Promise<any>) {
	const setHeader = vi.fn();
	const event = { res: { setHeader }, context: {} };
	let result: any;
	try {
		result = await handler(event);
	} catch (err) {
		result = err;
	}
	return { result, setHeader };
}

describe("robots.txt route", () => {
	it("should fetch from backend /robots.txt", async () => {
		const { default: handler } = await import("~/../server/routes/robots.txt");
		await callRoute(handler);

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(`${apiUrl}/robots.txt`);
	});

	it("should set text/plain content-type", async () => {
		const { default: handler } = await import("~/../server/routes/robots.txt");
		const { setHeader } = await callRoute(handler);

		expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
	});

	it("should return backend response", async () => {
		const { default: handler } = await import("~/../server/routes/robots.txt");
		const { result } = await callRoute(handler);

		expect(result).toBe("<xml>backend-content</xml>");
	});

	it("should create error when backend fails", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection failed"));
		const { default: handler } = await import("~/../server/routes/robots.txt");
		const { result } = await callRoute(handler);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("Failed to fetch robots.txt");
	});
});

describe("sitemap.xml route", () => {
	it("should fetch from backend /sitemap.xml", async () => {
		const { default: handler } = await import("~/../server/routes/sitemap.xml");
		await callRoute(handler);

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(`${apiUrl}/sitemap.xml`);
		expect(fetchCalls[0].options.headers).toEqual({
			Accept: "application/xml",
		});
	});

	it("should set application/xml content-type", async () => {
		const { default: handler } = await import("~/../server/routes/sitemap.xml");
		const { setHeader } = await callRoute(handler);

		expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/xml; charset=utf-8");
	});

	it("should create error when backend fails", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Failed"));
		const { default: handler } = await import("~/../server/routes/sitemap.xml");
		const { result } = await callRoute(handler);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("Failed to fetch sitemap");
	});
});

describe("RSS feed route", () => {
	it("should fetch from backend /rss/feed.xml", async () => {
		const { default: handler } = await import("~/../server/routes/rss/feed.xml");
		await callRoute(handler);

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(`${apiUrl}/rss/feed.xml`);
		expect(fetchCalls[0].options.headers).toEqual({
			Accept: "application/rss+xml",
		});
	});

	it("should set application/rss+xml content-type", async () => {
		const { default: handler } = await import("~/../server/routes/rss/feed.xml");
		const { setHeader } = await callRoute(handler);

		expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/rss+xml; charset=utf-8");
	});

	it("should create error when backend fails", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Failed"));
		const { default: handler } = await import("~/../server/routes/rss/feed.xml");
		const { result } = await callRoute(handler);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("Failed to fetch RSS feed");
	});
});

describe("Atom feed route", () => {
	it("should fetch from backend /rss/atom.xml", async () => {
		const { default: handler } = await import("~/../server/routes/rss/atom.xml");
		await callRoute(handler);

		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(`${apiUrl}/rss/atom.xml`);
		expect(fetchCalls[0].options.headers).toEqual({
			Accept: "application/atom+xml",
		});
	});

	it("should set application/atom+xml content-type", async () => {
		const { default: handler } = await import("~/../server/routes/rss/atom.xml");
		const { setHeader } = await callRoute(handler);

		expect(setHeader).toHaveBeenCalledWith("Content-Type", "application/atom+xml; charset=utf-8");
	});

	it("should create error when backend fails", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Failed"));
		const { default: handler } = await import("~/../server/routes/rss/atom.xml");
		const { result } = await callRoute(handler);

		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe("Failed to fetch Atom feed");
	});
});
