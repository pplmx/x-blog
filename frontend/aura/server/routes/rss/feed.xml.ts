/**
 * RSS 2.0 feed route.
 * Proxies to the backend's `/rss/feed.xml` endpoint which generates the feed.
 */
export default defineEventHandler(async (event) => {
	// Absolute backend URL: a relative fallback here would make $fetch
	// recurse into the app's own handlers (localFetch) when NUXT_API_URL
	// is unset, hanging the request.
	const apiUrl = process.env.NUXT_API_URL || "http://localhost:18888";

	try {
		const feed = await $fetch<string>(`${apiUrl}/rss/feed.xml`, {
			method: "GET",
			headers: { Accept: "application/rss+xml" },
		});

		event.res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
		return feed;
	} catch (error) {
		console.error("RSS feed proxy error:", error);
		throw createError({
			statusCode: 502,
			statusMessage: "Failed to fetch RSS feed",
		});
	}
});
