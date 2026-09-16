/**
 * Discussion Atom route (round 368, DEC-409).
 * Proxies to the backend's `/rss/comments.atom.xml` endpoint which streams the
 * latest approved comments as Atom, forwarding ETag / Cache-Control and
 * honoring If-None-Match (304) for reader revalidation.
 */
import { proxyConditionalFeed } from "../../utils/proxyFeed";

export default defineEventHandler((event) =>
	proxyConditionalFeed(event, "/rss/comments.atom.xml", "application/atom+xml"),
);
