/**
 * XML sitemap route.
 * Proxies to the backend's `/sitemap.xml` endpoint which generates the sitemap.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const apiUrl = config.public.apiUrl;

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
