/**
 * Atom feed route.
 * Proxies to the backend's `/rss/atom.xml` endpoint, forwarding ETag /
 * Cache-Control and honoring If-None-Match (304) for reader revalidation.
 */
import { proxyConditionalFeed } from "../../utils/proxyFeed";

export default defineEventHandler((event) =>
	proxyConditionalFeed(event, "/rss/atom.xml", "application/atom+xml"),
);
