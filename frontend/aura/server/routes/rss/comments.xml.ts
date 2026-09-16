/**
 * Discussion RSS 2.0 route (round 368, DEC-409).
 * Proxies to the backend's `/rss/comments.xml` endpoint which streams the
 * latest approved comments, forwarding ETag / Cache-Control and honoring
 * If-None-Match (304) so feed readers polling the Nuxt origin can revalidate
 * instead of re-downloading (same contract as the post feeds).
 */
import { proxyConditionalFeed } from "../../utils/proxyFeed";

export default defineEventHandler((event) =>
	proxyConditionalFeed(event, "/rss/comments.xml", "application/rss+xml"),
);
