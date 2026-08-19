/**
 * RSS 2.0 feed route.
 * Proxies to the backend's `/rss/feed.xml` endpoint which generates the feed,
 * forwarding ETag / Cache-Control and honoring If-None-Match (304) so feed
 * readers polling the Nuxt origin can revalidate instead of re-downloading.
 */
import { proxyConditionalFeed } from "../../utils/proxyFeed";

export default defineEventHandler((event) =>
	proxyConditionalFeed(event, "/rss/feed.xml", "application/rss+xml"),
);
