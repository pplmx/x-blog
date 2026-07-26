/**
 * RSS 2.0 feed route.
 * Proxies to the backend's `/rss/feed.xml` endpoint which generates the feed.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const apiUrl = config.public.apiUrl;

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
