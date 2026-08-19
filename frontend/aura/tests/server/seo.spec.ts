/**
 * Server route tests for SEO endpoints (robots.txt, sitemap.xml, RSS, Atom).
 *
 * robots.txt still proxies with a plain `$fetch<string>`.
 * sitemap.xml / rss/feed.xml / rss/atom.xml go through the shared
 * `proxyConditionalFeed` helper (server/utils/proxyFeed.ts, RIL DEC-058 /
 * TASK-130), which must preserve the backend conditional-GET contract:
 * forward ETag / Cache-Control / Content-Type, honor If-None-Match -> 304
 * (bodyless), and surface genuine backend failures as a 502 createError.
 *
 * Nuxt/h3 globals used by these handlers are stubbed before import. Route
 * modules are imported statically so vite can transform them; each test reloads
 * via `vi.resetModules()` where a fresh module matters.
 */
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Stub Nuxt/h3 globals before any (runtime) route-module imports.
vi.stubGlobal(
	"defineEventHandler",
	(fn: (event: never) => unknown) => fn as (event: never) => unknown,
);

// Route modules are imported dynamically inside tests (as the original spec
// did): their evaluation references stubbed Nuxt globals, which are only set
// after beforeEach runs. The paths are string literals so vite pre-transforms
// them. `defineEventHandler` is the identity here, so `.default` is the handler.
async function loadRobotsHandler() {
	const mod = await import("~/../server/routes/robots.txt");
	return mod.default as (event: never) => unknown;
}

async function loadProxyHandler(route: "sitemap.xml" | "rss/feed.xml" | "rss/atom.xml") {
	switch (route) {
		case "sitemap.xml":
			return (await import("~/../server/routes/sitemap.xml")).default as (event: never) => unknown;
		case "rss/feed.xml":
			return (await import("~/../server/routes/rss/feed.xml")).default as (event: never) => unknown;
		case "rss/atom.xml":
			return (await import("~/../server/routes/rss/atom.xml")).default as (event: never) => unknown;
	}
}

interface FetchCall {
	url: string;
	options: Record<string, unknown>;
}

let fetchCalls: FetchCall[];
let mockFetch: Mock;
const apiUrl = "http://localhost:18888";

/** Build an ofetch.raw()-shaped resolved value. */
function mockRawResponse(
	status = 200,
	headers: Record<string, string> = {},
	body: unknown = "<xml>backend-content</xml>",
) {
	return { status, headers: new Headers(headers), _data: body };
}

/** A mock H3 event that records response status/headers set by the handler. */
function makeEvent(requestHeaders: Record<string, string> = {}) {
	return {
		headers: { ...requestHeaders },
		status: undefined as number | undefined,
		responseHeaders: {} as Record<string, string>,
	};
}

beforeEach(() => {
	fetchCalls = [];

	vi.stubGlobal("useRuntimeConfig", () => ({
		public: { apiUrl },
	}));

	vi.stubGlobal(
		"getRequestHeader",
		(event: Record<string, unknown>, name: string) =>
			((event.headers as Record<string, string>)?.[name] as string | undefined) ?? null,
	);
	vi.stubGlobal("setResponseStatus", (event: { status?: number }, status: number) => {
		event.status = status;
	});
	vi.stubGlobal(
		"setResponseHeader",
		(event: { responseHeaders: Record<string, string> }, key: string, value: string) => {
			event.responseHeaders[key.toLowerCase()] = value;
		},
	);

	mockFetch = vi.fn((url: string, options: Record<string, unknown> = {}) => {
		fetchCalls.push({ url, options });
		return Promise.resolve("<xml>backend-content</xml>");
	}) as Mock;
	mockFetch.raw = vi.fn((url: string, options: Record<string, unknown> = {}) => {
		fetchCalls.push({ url, options });
		return Promise.resolve(mockRawResponse());
	});
	vi.stubGlobal("$fetch", mockFetch);

	vi.stubGlobal("createError", (opts: Record<string, unknown>) => {
		const err = new Error(opts.statusMessage as string);
		Object.assign(err, opts);
		return err;
	});
});

async function callRoute(handler: (event: never) => unknown) {
	// robots.txt writes via event.res.setHeader; the proxy handlers ignore `res`.
	const event = makeEvent() as {
		headers: Record<string, string>;
		status?: number;
		responseHeaders: Record<string, string>;
		res?: { setHeader: ReturnType<typeof vi.fn> };
	};
	event.res = { setHeader: vi.fn() };
	let result: unknown;
	try {
		result = await handler(event);
	} catch (err) {
		result = err;
	}
	return { result, event };
}

describe("robots.txt route", () => {
	it("should fetch from backend /robots.txt", async () => {
		const handler = await loadRobotsHandler();
		await callRoute(handler);
		expect(fetchCalls).toHaveLength(1);
		expect(fetchCalls[0].url).toBe(`${apiUrl}/robots.txt`);
	});

	it("should set text/plain content-type", async () => {
		const handler = await loadRobotsHandler();
		const setHeader = vi.fn();
		await handler({ res: { setHeader } } as never);
		expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
	});

	it("should return backend response", async () => {
		const { result } = await callRoute(await loadRobotsHandler());
		expect(result).toBe("<xml>backend-content</xml>");
	});

	it("should create error when backend fails", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Connection failed"));
		const { result } = await callRoute(await loadRobotsHandler());
		expect(result).toBeInstanceOf(Error);
		expect(result).toHaveProperty("message", "Failed to fetch robots.txt");
	});

	it("should prefer NUXT_PROXY_TARGET over NUXT_API_URL (compose topology)", async () => {
		const prevProxy = process.env.NUXT_PROXY_TARGET;
		const prevApi = process.env.NUXT_API_URL;
		vi.resetModules();
		process.env.NUXT_PROXY_TARGET = "http://backend:18888";
		delete process.env.NUXT_API_URL;
		try {
			const freshHandler = await loadRobotsHandler();
			await callRoute(freshHandler);
			expect(fetchCalls).toHaveLength(1);
			expect(fetchCalls[0].url).toBe("http://backend:18888/robots.txt");
		} finally {
			if (prevProxy === undefined) delete process.env.NUXT_PROXY_TARGET;
			else process.env.NUXT_PROXY_TARGET = prevProxy;
			if (prevApi === undefined) delete process.env.NUXT_API_URL;
			else process.env.NUXT_API_URL = prevApi;
		}
	});
});

// sitemap.xml / rss/feed.xml / rss/atom.xml all delegate to proxyConditionalFeed
// with a different path + Accept header, so they share the same contract tests.
const PROXY_ROUTES = [
	{
		name: "sitemap.xml",
		route: "sitemap.xml" as const,
		path: "/sitemap.xml",
		accept: "application/xml",
	},
	{
		name: "rss/feed.xml",
		route: "rss/feed.xml" as const,
		path: "/rss/feed.xml",
		accept: "application/rss+xml",
	},
	{
		name: "rss/atom.xml",
		route: "rss/atom.xml" as const,
		path: "/rss/atom.xml",
		accept: "application/atom+xml",
	},
];

describe("conditional feed/sitemap proxy routes", () => {
	for (const { name, route, path, accept } of PROXY_ROUTES) {
		describe(name, () => {
			it("should fetch the backend route with the right Accept header", async () => {
				await callRoute(await loadProxyHandler(route));
				expect(fetchCalls).toHaveLength(1);
				expect(fetchCalls[0].url).toBe(`${apiUrl}${path}`);
				expect(fetchCalls[0].options.headers).toMatchObject({ accept });
			});

			it("should forward ETag/Cache-Control/Content-Type and status", async () => {
				mockFetch.raw.mockResolvedValueOnce(
					mockRawResponse(200, {
						etag: '"abc123"',
						"cache-control": "public, max-age=60",
						"content-type": accept,
					}),
				);
				const { result, event } = await callRoute(await loadProxyHandler(route));
				expect(event.status).toBe(200);
				expect(result).toBe("<xml>backend-content</xml>");
				expect(event.responseHeaders.etag).toBe('"abc123"');
				expect(event.responseHeaders["cache-control"]).toBe("public, max-age=60");
				expect(event.responseHeaders["content-type"]).toBe(accept);
			});

			it("should return bodyless on a backend 304", async () => {
				mockFetch.raw.mockResolvedValueOnce(
					mockRawResponse(304, { etag: '"abc123"', "cache-control": "public, max-age=60" }),
				);
				const { result, event } = await callRoute(await loadProxyHandler(route));
				expect(event.status).toBe(304);
				expect(event.responseHeaders.etag).toBe('"abc123"');
				expect(result).toBeUndefined();
			});

			it("should forward the client If-None-Match to the backend", async () => {
				const event = makeEvent({ "if-none-match": '"abc123"' });
				await (await loadProxyHandler(route))(event);
				// The default $fetch.raw mock records request options; asserting
				// the forwarded header proves revalidation reaches the backend.
				expect(fetchCalls[0].options.headers).toMatchObject({ "if-none-match": '"abc123"' });
			});

			it("should create a 502 error when the backend connection fails", async () => {
				mockFetch.raw.mockRejectedValueOnce(new Error("ECONNREFUSED"));
				const { result } = await callRoute(await loadProxyHandler(route));
				expect(result).toBeInstanceOf(Error);
				expect(result).toHaveProperty("statusCode", 502);
			});
		});
	}
});
