/**
 * Static file proxy server route.
 *
 * Proxies /static/* requests to the backend, enabling uploaded images
 * (e.g. /static/uploads/2024/07/image.jpg) to resolve through the Nuxt
 * frontend without CORS issues.
 */

const BACKEND_URL = process.env.NUXT_API_URL || "http://localhost:18888";

export default defineEventHandler(async (event) => {
	const path = getRouterParam(event, "path") || "";
	const url = `${BACKEND_URL}/static/${path}`;

	// Forward selected request headers
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(getHeaders(event))) {
		if (["host", "connection", "content-length"].includes(key)) continue;
		headers[key] = value as string;
	}

	try {
		const response = await fetch(url, {
			method: "GET",
			headers,
		});

		setResponseStatus(event, response.status);
		for (const [key, value] of response.headers.entries()) {
			if (["content-encoding", "transfer-encoding"].includes(key)) continue;
			setResponseHeader(event, key, value);
		}

		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer);
	} catch {
		throw createError({ statusCode: 502, message: "Backend unavailable" });
	}
});
