/**
 * Proxy a backend feed/sitemap endpoint to the client while preserving the
 * conditional-GET contract the backend already implements (strong ETag, 304 on
 * If-None-Match, Cache-Control — rss.py TASK-089 / routers/conditional.py
 * TASK-128). The earlier `$fetch<string>` proxies dropped those headers, so
 * feed readers hitting the Nuxt edge could never revalidate and re-downloaded
 * the body on every poll; this restores 200 -> 304 through the Nuxt origin.
 */
import type { H3Event } from "h3";

/** Proxied backend cache headers the browser cache actually uses. */
const FORWARD_CACHE_HEADERS = ["etag", "cache-control", "content-type"] as const;

export async function proxyConditionalFeed(
	event: H3Event,
	apiPath: string,
	contentType: string,
): Promise<string | undefined> {
	const apiUrl =
		process.env.NUXT_PROXY_TARGET || process.env.NUXT_API_URL || "http://localhost:18888";

	const ifNoneMatch = getRequestHeader(event, "if-none-match");

	// $fetch here is the nitro auto-import (a free global; the vitest spec
	// stubs it). `any` keeps the assignment readable — the router-typed return
	// type otherwise trips TS's stack-depth check — and only status/headers/
	// _data are consumed below.
	let response: any; // eslint-disable-line
	try {
		response = await $fetch.raw(`${apiUrl}${apiPath}`, {
			method: "GET",
			responseType: "text",
			headers: {
				accept: contentType,
				...(ifNoneMatch ? { "if-none-match": ifNoneMatch } : {}),
			},
		});
	} catch (error) {
		console.error(`feed proxy (${apiPath}) error:`, error);
		throw createError({ statusCode: 502, statusMessage: "Failed to fetch feed" });
	}

	setResponseStatus(event, response.status);
	for (const key of FORWARD_CACHE_HEADERS) {
		const value = response.headers.get(key);
		if (value) setResponseHeader(event, key, value);
	}

	// 304 Not Modified arrives with an empty body; signal a bodyless reply so
	// the browser keeps its cached copy refreshed by the forwarded Cache-Control.
	if (response.status === 304) return;
	return response._data as string;
}
