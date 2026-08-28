/**
 * Scoped category/series feed routes (DEC-130, TASK-177).
 *
 * The backend serves `/rss/category/{name}.xml` and `/rss/series/{slug}.xml`,
 * and the category/series pages advertise those URLs (autodiscovery + a
 * visible subscribe link). The Nuxt origin previously proxied only the
 * unscoped `feed.xml` / `atom.xml` files, so the scoped links 404'd whenever
 * the frontend origin fronts RSS — dev (`nuxt preview`) and any topology
 * without nginx's `location /rss/ -> backend`. This catch-all fronts the two
 * scoped forms with the same conditional-GET contract as the unscoped files
 * (strong ETag / 304 / Cache-Control via `proxyConditionalFeed`); `feed.xml`
 * and `atom.xml` still match their dedicated files first.
 */

import { proxyConditionalFeed } from "../../utils/proxyFeed";

export default defineEventHandler((event) => {
	const path = getRouterParam(event, "path") || "";
	const kind = path.split("/")[0];
	if (kind !== "category" && kind !== "series") {
		throw createError({ statusCode: 404, statusMessage: "Not found" });
	}
	return proxyConditionalFeed(event, `/rss/${path}`, "application/rss+xml");
});
