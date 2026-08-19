/**
 * XML sitemap route.
 * Proxies to the backend's `/sitemap.xml` endpoint, forwarding ETag /
 * Cache-Control and honoring If-None-Match (304) so crawlers can revalidate
 * instead of re-downloading the potentially large sitemap.
 */
import { proxyConditionalFeed } from "../utils/proxyFeed";

export default defineEventHandler((event) =>
	proxyConditionalFeed(event, "/sitemap.xml", "application/xml"),
);
