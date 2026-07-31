/**
 * Static file proxy server route.
 *
 * Proxies /static/* requests to the backend, enabling uploaded images
 * (e.g. /static/uploads/2024/07/image.jpg) to resolve through the Nuxt
 * frontend without CORS issues.
 *
 * Security: the path is validated to stay inside /static/ (no `..` segments,
 * no absolute URLs), and only cache-related headers are forwarded — the admin
 * Authorization header must never leak to this unauthenticated proxy.
 */

const BACKEND_URL = process.env.NUXT_API_URL || "http://localhost:18888";

// Headers that are safe to forward to the backend's static file handler
const FORWARD_HEADERS = new Set([
	"accept",
	"accept-encoding",
	"cache-control",
	"if-modified-since",
	"if-none-match",
	"range",
]);

export default defineEventHandler(async (event) => {
	const path = getRouterParam(event, "path") || "";

	// Path validation: reject traversal attempts (%2e%2e%2f is already decoded
	// by Nitro) and anything that would escape the /static/ sandbox.
	if (
		path.includes("..") ||
		path.startsWith("/") ||
		path.startsWith("\\") ||
		path.includes(":") ||
		path.includes("\0")
	) {
		throw createError({ statusCode: 400, message: "Invalid static path" });
	}

	const url = `${BACKEND_URL}/static/${path}`;

	// Forward only cache-related headers (no cookies, no authorization)
	const headers: Record<string, string> = {};
	for (const [key, value] of Object.entries(getHeaders(event))) {
		if (FORWARD_HEADERS.has(key.toLowerCase())) {
			headers[key] = value as string;
		}
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
