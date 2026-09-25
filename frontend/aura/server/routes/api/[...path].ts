import type { H3Event } from "h3";
import { resolveClientIp } from "~~/server/utils/clientIp";

// Server-side backend target. NUXT_PROXY_TARGET is the server-only variable;
// NUXT_API_URL is kept as a fallback but is ALSO injected into the client
// bundle (runtimeConfig.public.apiUrl), so it must never point at a
// docker-internal hostname (e.g. http://backend:18888) — browsers cannot
// resolve those, and every search/API call would hit a wrong URL.
const BACKEND_URL =
	process.env.NUXT_PROXY_TARGET || process.env.NUXT_API_URL || "http://localhost:18888";

// Largest legitimate proxied body is a 5MB image upload (backend MAX_SIZE)
// plus multipart framing; anything well above that is an abuse attempt. The
// proxy is the public network edge, so a body this large must be rejected HERE
// — otherwise an attacker can make the frontend buffer an arbitrarily large
// request in memory (readRawBody reads the whole stream) before the backend's
// upload cap ever sees it. (RIL TASK-037)
const MAX_PROXY_BODY = 6 * 1024 * 1024; // 6MB

/** Reject requests whose body exceeds MAX_PROXY_BODY with 413 (before buffering). */
function assertBodyWithinLimit(event: H3Event): void {
	const contentLength = getRequestHeader(event, "content-length");
	if (contentLength && Number.parseInt(contentLength, 10) > MAX_PROXY_BODY) {
		throw createError({ statusCode: 413, statusMessage: "Request body too large" });
	}
	// Chunked bodies carry no content-length. The backend also caps bodies, but
	// rejecting here avoids draining an unbounded request stream into memory.
	const declared = event.node?.req?.headers["transfer-encoding"];
	if (declared?.toString().toLowerCase().includes("chunked")) {
		throw createError({ statusCode: 400, statusMessage: "Chunked request bodies not supported" });
	}
}

export default defineEventHandler(async (event) => {
	const path = getRouterParam(event, "path") || "";
	const method = getMethod(event).toLowerCase();
	// Forward the incoming query string — without it, ?page=2&q=... never
	// reached the backend, silently breaking pagination/search/filters for
	// every client using the proxy (apiUrl unset).
	const query = getQuery(event);
	const qs = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const v of value) qs.append(key, String(v));
		} else {
			qs.set(key, String(value));
		}
	}
	const queryString = qs.toString();
	const url = `${BACKEND_URL}/api/${path}${queryString ? `?${queryString}` : ""}`;

	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(getHeaders(event))) {
		if (["host", "connection", "content-length"].includes(key)) continue;
		headers[key] = value as string;
	}
	// The Nuxt proxy is the API edge in the compose/nginx topology: the browser
	// talks to Nuxt, and the backend sees the Nuxt container as its peer. We
	// OVERWRITE (never append) x-forwarded-for/x-real-ip from the resolved edge
	// IP below so a caller cannot chain a forged entry into the backend's trust
	// chain; how that edge IP is resolved (real client through a trusted proxy,
	// else the socket peer) follows the trust model, not a raw header.
	//
	// The browser talks to Nuxt, and the backend sees the Nuxt container as its
	// peer. In the nginx topology (deploy/nginx.conf), nginx sits in front with
	// the real client in X-Forwarded-For and the socket peer is nginx itself —
	// forwarding the peer alone (getRequestIP with xForwardedFor:false) would
	// collapse EVERY client into that one loopback IP, so the backend's per-IP
	// registrations/rates all shared a single bucket. resolveClientIp applies
	// the same trust model the frontend's own limiters use (RIL TASK-101,
	// ISS-081): only when the peer is a trusted proxy (FRONTEND_TRUSTED_PROXIES)
	// does it take the REAL client from XFF; otherwise it returns the peer
	// (compose/bare topology, client-supplied XFF discarded — no spoofed
	// bucket). The backend then re-validates against ITS TRUSTED_PROXIES.
	const edgeIp = resolveClientIp(
		getRequestIP(event, { xForwardedFor: false }) || "unknown",
		getRequestHeader(event, "x-forwarded-for"),
		process.env.FRONTEND_TRUSTED_PROXIES,
	);
	headers["x-forwarded-for"] = edgeIp;
	headers["x-real-ip"] = edgeIp;

	// Pass request bodies through RAW. h3's readBody returns null-prototype
	// objects for form-urlencoded bodies, which ofetch 1.5.1 (the nitro
	// runtime's fetch) cannot serialize — every form POST 502'd with
	// "Cannot convert object to primitive value". Raw passthrough is also
	// byte-exact, which is what a proxy should be.
	//
	// readRawBody(event, false) returns the Buffer, NOT a utf8 string: h3's
	// default decoded-string form mangles binary bodies (image uploads) — the
	// invalid-utf8 image bytes collapse to U+FFFD and the backend's magic-byte
	// check rejects the mutated bytes. Buffers round-trip byte-exact. (Fix
	// surfaced by the media-library e2e upload; every admin image upload
	// through this proxy failed with 400 before this.)
	let body: Buffer | undefined;
	if (method !== "get" && method !== "head" && getRequestHeader(event, "content-type") !== null) {
		assertBodyWithinLimit(event);
		body = await readRawBody(event, false);
	}

	/** Framing headers h3/nitro owns; anything else must reach the browser. */
	const HOP_BY_HOP_HEADERS = [
		"content-encoding",
		"transfer-encoding",
		"connection",
		"content-length",
	];

	/**
	 * Copy a backend response's headers onto the origin response. ofetch exposes
	 * Headers-like (iterable) headers; iterate entries rather than Object.entries
	 * (which sees nothing) so backend headers — conditional ETag/Cache-Control
	 * (TASK-128), rate-limit, and error-path headers like X-Redirect-To (round
	 * 350) — actually reach the browser.
	 */
	function forwardHeaders(event: H3Event, responseHeaders: Headers | Record<string, string>): void {
		if (!responseHeaders) return;
		const entries =
			typeof responseHeaders.entries === "function"
				? [...responseHeaders.entries()]
				: Object.entries(responseHeaders);
		for (const [key, value] of entries) {
			// Let h3/nitro own framing: content-length must not be forwarded
			// (re-encoded bodies and bodyless 304s would conflict with it).
			if (HOP_BY_HOP_HEADERS.includes(key.toLowerCase())) {
				continue;
			}
			setResponseHeader(event, key, String(value));
		}
	}

	try {
		const response = await $fetch.raw(url, {
			method: method as any,
			headers,
			body,
		});

		setResponseStatus(event, response.status);
		forwardHeaders(event, response.headers);

		// Bodyless 304: forward the cache headers above, return no body.
		if (response.status === 304) return;
		return response._data;
	} catch (err: any) {
		if (err.response) {
			setResponseStatus(event, err.response.status);
			forwardHeaders(event, err.response.headers);
			return err.response._data;
		}
		console.error(
			"[api-proxy] backend unavailable:",
			method,
			url,
			err?.cause?.message || err?.message,
		);
		throw createError({ statusCode: 502, message: "Backend unavailable" });
	}
});
