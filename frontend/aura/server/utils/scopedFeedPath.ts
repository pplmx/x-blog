/**
 * Pure path validation for the scoped-feed catch-all route
 * (`routes/rss/[...path].ts`). Kept free of Nuxt/Nitro globals so it is
 * unit-testable in isolation.
 *
 * The proxy forwards `/rss/{path}` to a fixed backend, and the HTTP client
 * resolves `..`/dot-segments and normalises extra `/`/`\` when it parses the
 * constructed target URL. Validating only the first segment therefore let a
 * crafted path like `category/../../admin/...` escape the `/rss/` prefix and
 * forward a GET to arbitrary backend paths. Requiring exactly two safe
 * segments bounds it to the backend's real scoped feed shapes.
 */

const FEED_KINDS = ["category", "series", "authors"] as const;

/** Whether a scoped-feed catch-all path is an allowed shape: exactly two safe
 *  segments (`<kind>/<name>`, e.g. `category/技术.xml`). */
export function isScopedFeedPath(path: string): boolean {
	const parts = path.split("/");
	if (parts.length !== 2) return false;
	const [kind, name] = parts;
	if (!kind || !name) return false;
	if (kind.includes("..") || name.includes("..") || kind.includes("\\") || name.includes("\\")) return false;
	return (FEED_KINDS as readonly string[]).includes(kind);
}
