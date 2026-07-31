/**
 * XML sitemap route.
 * Proxies to the backend's `/sitemap.xml` endpoint which generates the sitemap.
 */
export default defineEventHandler(async (event) => {
	// Absolute backend URL: a relative fallback here would make $fetch
	// recurse into the app's own handlers (localFetch) when NUXT_API_URL
	// is unset, hanging the request.
	const apiUrl =
		process.env.NUXT_PROXY_TARGET || process.env.NUXT_API_URL || "http://localhost:18888";

	try {
		const sitemap = await $fetch<string>(`${apiUrl}/sitemap.xml`, {
			method: "GET",
			headers: { Accept: "application/xml" },
		});

		event.res.setHeader("Content-Type", "application/xml; charset=utf-8");
		return sitemap;
	} catch (error) {
		console.error("Sitemap proxy error:", error);
		throw createError({
			statusCode: 502,
			statusMessage: "Failed to fetch sitemap",
		});
	}
});
