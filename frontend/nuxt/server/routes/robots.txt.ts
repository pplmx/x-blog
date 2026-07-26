/**
 * robots.txt route.
 * Proxies to the backend's `/robots.txt` endpoint.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const apiUrl = config.public.apiUrl;

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
