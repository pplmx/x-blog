/**
 * Atom feed route.
 * Proxies to the backend's `/rss/atom.xml` endpoint which generates the feed.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const apiUrl = config.public.apiUrl;

  try {
    const feed = await $fetch<string>(`${apiUrl}/rss/atom.xml`, {
      method: "GET",
      headers: { Accept: "application/atom+xml" },
    });

    event.res.setHeader("Content-Type", "application/atom+xml; charset=utf-8");
    return feed;
  } catch (error) {
    console.error("Atom feed proxy error:", error);
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to fetch Atom feed",
    });
  }
});
