// Server-side backend target. NUXT_PROXY_TARGET is the server-only variable;
// NUXT_API_URL is kept as a fallback but is ALSO injected into the client
// bundle (runtimeConfig.public.apiUrl), so it must never point at a
// docker-internal hostname (e.g. http://backend:18888) — browsers cannot
// resolve those, and every search/API call would hit a wrong URL.
const BACKEND_URL =
	process.env.NUXT_PROXY_TARGET || process.env.NUXT_API_URL || "http://localhost:18888";

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

	// Pass request bodies through RAW. h3's readBody returns null-prototype
	// objects for form-urlencoded bodies, which ofetch 1.5.1 (the nitro
	// runtime's fetch) cannot serialize — every form POST 502'd with
	// "Cannot convert object to primitive value". Raw passthrough is also
	// byte-exact, which is what a proxy should be.
	const hasBody = getRequestHeader(event, "content-type") !== null;
	const body =
		method === "get" || method === "head" || !hasBody ? undefined : await readRawBody(event);

	try {
		const response = await $fetch.raw(url, {
			method: method as any,
			headers,
			body,
		});

		setResponseStatus(event, response.status);
		for (const [key, value] of Object.entries(response.headers)) {
			if (["content-encoding", "transfer-encoding", "connection"].includes(key)) continue;
			setResponseHeader(event, key, value);
		}

		return response._data;
	} catch (err: any) {
		if (err.response) {
			setResponseStatus(event, err.response.status);
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
