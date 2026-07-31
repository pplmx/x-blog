const BACKEND_URL = process.env.NUXT_API_URL || "http://localhost:18888";

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

	const body = method === "get" || method === "head" ? undefined : await readBody(event);

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
		throw createError({ statusCode: 502, message: "Backend unavailable" });
	}
});
