/**
 * robots.txt route.
 * Proxies to the backend's `/robots.txt` endpoint.
 */
export default defineEventHandler(async (event) => {
	// Absolute backend URL: NUXT_PROXY_TARGET is the server-only variable set in
	// production compose (NUXT_API_URL is deliberately unset there because it
	// would be baked into the client bundle and point browsers at a docker-host
	// that they can't resolve). A relative fallback would make $fetch recurse
	// into the app's own handlers (localFetch) and hang the request.
	const apiUrl =
		process.env.NUXT_PROXY_TARGET || process.env.NUXT_API_URL || "http://localhost:18888";

	try {
		const robots = await $fetch<string>(`${apiUrl}/robots.txt`, {
			method: "GET",
			headers: { Accept: "text/plain" },
		});

		event.res.setHeader("Content-Type", "text/plain; charset=utf-8");
		return robots;
	} catch (error) {
		console.error("robots.txt proxy error:", error);
		throw createError({
			statusCode: 502,
			statusMessage: "Failed to fetch robots.txt",
		});
	}
});
